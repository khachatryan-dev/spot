import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import {
  type Payment,
  payments,
  type Reservation,
  reservationHolds,
  reservations,
  restaurantLocations,
  restaurants,
} from "@/server/db/schema";
import { publishReservationEvent } from "@/server/events/reservation-events";
import { announceReservation } from "@/server/notifications/reservation-notices";
import { logger } from "@/server/logger";
import { clientEnv } from "@/shared/config/env.client";
import type { PaymentStatus } from "@/shared/constants/payments";
import { isPaid } from "@/shared/domain/payment-status";
import { isRefundableCancellation } from "@/shared/domain/reservation-deposit";
import { AppError } from "@/shared/errors";

import { startPayment, syncPayment } from "./payment-service";
import { refundPaymentAutomatically } from "./refund-service";

/*
 * Reservation deposits (§19 "PENDING_PAYMENT → confirmed", §21). A booking
 * with a deposit holds its table for a short payment window; once the
 * provider confirms the payment the booking moves on (confirmed, or to staff
 * for manual confirmation). Money taken for a booking that is no longer
 * active is refunded automatically, as are deposits for bookings the
 * restaurant cancels or the guest cancels before the location's cutoff.
 */

type Actor = Pick<SessionUser, "id">;
const log = logger.child({ module: "reservation-deposits" });

const depositPaymentsOf = (reservationId: string) =>
  db
    .select()
    .from(payments)
    .where(
      and(eq(payments.reservationId, reservationId), eq(payments.purpose, "reservation_deposit")),
    )
    .orderBy(asc(payments.createdAt));

/**
 * Send the guest to pay their booking's deposit. Reuses a payment still in
 * progress; after a failed attempt, starts a new one.
 */
export async function startDepositPayment(
  actor: Actor,
  reservationId: string,
): Promise<{ redirectUrl: string | null }> {
  if (!z.uuid().safeParse(reservationId).success) {
    throw new AppError("NOT_FOUND", "Reservation not found.");
  }
  const [row] = await db
    .select({ reservation: reservations, currency: restaurants.currency, name: restaurants.name })
    .from(reservations)
    .innerJoin(restaurants, eq(restaurants.id, reservations.restaurantId))
    .where(and(eq(reservations.id, reservationId), eq(reservations.customerUserId, actor.id)));
  if (!row) throw new AppError("NOT_FOUND", "Reservation not found.");
  const { reservation } = row;

  const attempts = await depositPaymentsOf(reservation.id);
  if (attempts.some((p) => isPaid(p.status) || p.status === "refunded")) {
    return { redirectUrl: null };
  }
  if (reservation.status !== "pending_payment" || reservation.depositMinor === 0) {
    throw new AppError("CONFLICT", "This reservation doesn't need a payment now.");
  }
  const open = attempts.findLast((p) => p.status === "pending" || p.status === "processing");
  const { redirectUrl } = await startPayment({
    restaurantId: reservation.restaurantId,
    purpose: "reservation_deposit",
    reservationId: reservation.id,
    customerUserId: actor.id,
    amountMinor: reservation.depositMinor,
    currency: row.currency,
    description: `Deposit — ${row.name}`,
    returnUrl: `${clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/reservations/pay/${reservation.id}`,
    idempotencyKey:
      open?.idempotencyKey ?? `reservation:${reservation.id}:deposit:${attempts.length + 1}`,
  });
  return { redirectUrl: redirectUrl ?? null };
}

/**
 * Apply a deposit payment's outcome to its booking. Safe to call any number
 * of times (it runs after every provider check). The first payment that
 * arrives while the booking still waits is accepted as its deposit; any
 * other paid deposit — a second payment, or one arriving after the booking
 * was given up — is refunded.
 */
export async function settleDeposit(payment: Payment): Promise<void> {
  if (payment.purpose !== "reservation_deposit" || !payment.reservationId) return;
  if (payment.status !== "succeeded") return;

  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        reservation: reservations,
        confirmation: restaurantLocations.reservationConfirmation,
      })
      .from(reservations)
      .innerJoin(restaurantLocations, eq(restaurantLocations.id, reservations.locationId))
      .where(eq(reservations.id, payment.reservationId!))
      .for("update", { of: reservations });
    if (!row) return { kind: "refund" as const };
    const { reservation } = row;
    if (reservation.depositPaymentId === payment.id) return { kind: "accepted" as const };
    if (reservation.depositPaymentId || reservation.status !== "pending_payment") {
      return { kind: "refund" as const };
    }

    const [hold] = await tx
      .select({ id: reservationHolds.id })
      .from(reservationHolds)
      .where(
        and(
          eq(reservationHolds.reservationId, reservation.id),
          isNull(reservationHolds.releasedAt),
        ),
      );
    if (!hold) return { kind: "refund" as const }; // the table was given back meanwhile

    const now = new Date();
    const confirmed = row.confirmation === "auto";
    const [updated] = await tx
      .update(reservations)
      .set({
        depositPaymentId: payment.id,
        ...(confirmed
          ? { status: "confirmed" as const, confirmedAt: now }
          : { status: "pending_confirmation" as const }),
      })
      .where(eq(reservations.id, reservation.id))
      .returning();
    await tx
      .update(reservationHolds)
      .set({ expiresAt: confirmed ? null : reservation.startsAt })
      .where(eq(reservationHolds.id, hold.id));
    await recordAudit(tx, {
      actor: null,
      action: "reservation.deposit_paid",
      entityType: "reservation",
      entityId: reservation.id,
      restaurantId: reservation.restaurantId,
      metadata: { paymentId: payment.id, amountMinor: payment.amountMinor, to: updated!.status },
    });
    return { kind: "moved" as const, reservation: updated! };
  });

  if (outcome.kind === "moved") {
    await announceReservation("deposit_paid", outcome.reservation.id);
    await publishReservationEvent({
      type: "RESERVATION_STATUS_CHANGED",
      restaurantId: outcome.reservation.restaurantId,
      locationId: outcome.reservation.locationId,
      reservationId: outcome.reservation.id,
      status: outcome.reservation.status,
    });
  } else if (outcome.kind === "refund") {
    await refundDeposit(
      payment,
      "unused",
      "Deposit not needed: the booking was already paid or no longer active.",
    );
  }
}

async function refundDeposit(payment: Payment, kind: string, reason: string) {
  const remaining = payment.amountMinor - payment.refundedMinor;
  if (remaining <= 0) return true;
  try {
    const { refund } = await refundPaymentAutomatically(payment.restaurantId, payment.id, {
      amountMinor: remaining,
      reason,
      idempotencyKey: `payment:${payment.id}:refund:${kind}`,
    });
    return refund.status !== "failed";
  } catch (error) {
    // The booking change stands; staff can refund by hand (and the error is logged).
    log.error("Automatic deposit refund failed", { err: error, paymentId: payment.id, kind });
    return false;
  }
}

/**
 * After a booking is cancelled: refund its deposit if the rules say so.
 * The restaurant cancelling or declining always refunds; a guest gets it
 * back when cancelling before the location's cutoff. Returns whether a
 * refund was made.
 */
export async function refundDepositIfOwed(
  reservation: Reservation,
  by: "guest" | "restaurant",
  now = new Date(),
): Promise<boolean> {
  if (reservation.status !== "cancelled" || reservation.depositMinor === 0) return false;
  const [location] = await db
    .select({ cutoff: restaurantLocations.reservationRefundCutoffHours })
    .from(restaurantLocations)
    .where(eq(restaurantLocations.id, reservation.locationId));
  if (by === "guest" && !isRefundableCancellation(reservation.startsAt, location!.cutoff, now)) {
    return false;
  }
  if (!reservation.depositPaymentId) return false;
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, reservation.depositPaymentId));
  const refunded =
    !!payment &&
    isPaid(payment.status) &&
    (await refundDeposit(payment, "cancelled", `Booking cancelled by the ${by}.`));
  return refunded;
}

export interface DepositState {
  status: PaymentStatus;
  amountMinor: number;
  refundedMinor: number;
}

/** The latest deposit payment of each booking, for lists. */
export async function depositStates(reservationIds: string[]): Promise<Map<string, DepositState>> {
  if (reservationIds.length === 0) return new Map();
  const rows = await db
    .select({
      reservationId: payments.reservationId,
      status: payments.status,
      amountMinor: payments.amountMinor,
      refundedMinor: payments.refundedMinor,
    })
    .from(payments)
    .where(
      and(
        inArray(payments.reservationId, reservationIds),
        eq(payments.purpose, "reservation_deposit"),
      ),
    )
    .orderBy(desc(payments.createdAt));
  const states = new Map<string, DepositState>();
  for (const row of rows) {
    // A paid attempt wins over later failed ones; otherwise the latest attempt.
    const current = states.get(row.reservationId!);
    if (!current || (!isPaid(current.status) && isPaid(row.status))) {
      states.set(row.reservationId!, row);
    }
  }
  return states;
}

/**
 * The guest is back from the payment page: check their booking's open
 * deposit payments with the provider now, rather than wait for a webhook.
 */
export async function refreshDepositOnReturn(actor: Actor, reservationId: string) {
  if (!z.uuid().safeParse(reservationId).success) return;
  const [own] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.customerUserId, actor.id)));
  if (!own) return;
  for (const payment of await depositPaymentsOf(reservationId)) {
    if (payment.status === "pending" || payment.status === "processing") {
      await syncPayment(payment.id, { source: "return" });
    }
  }
}
