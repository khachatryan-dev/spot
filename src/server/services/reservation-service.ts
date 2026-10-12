import "server-only";

import { and, asc, eq, gt, gte, inArray, isNull, lt, type SQL } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db, type Transaction } from "@/server/db/client";
import {
  diningTables,
  type Reservation,
  reservationHolds,
  reservations,
  restaurantLocations,
  restaurants,
} from "@/server/db/schema";
import { publishReservationEvent } from "@/server/events/reservation-events";
import {
  announceReservation,
  type ReservationEvent,
} from "@/server/notifications/reservation-notices";
import { paymentsAvailable } from "@/server/payments/registry";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import type { AuditAction } from "@/shared/constants/audit";
import {
  ACTIVE_RESERVATION_STATUSES,
  DEPOSIT_PAYMENT_MINUTES,
  type ReservationStatus,
} from "@/shared/constants/reservations";
import { depositFor } from "@/shared/domain/reservation-deposit";
import { addDays, zonedTime } from "@/shared/domain/reservation-slots";
import {
  actionBlocker,
  canCustomerCancel,
  FINAL_RESERVATION_STATUSES,
  RESERVATION_ACTIONS,
  STAFF_RESERVATION_ACTIONS,
  type StaffReservationAction,
} from "@/shared/domain/reservation-status";
import { AppError } from "@/shared/errors";
import {
  calendarDateSchema,
  type CreateReservationInput,
  createReservationSchema,
} from "@/shared/schemas/reservation";

import { loadBookableLocation } from "./reservation-availability-service";
import {
  type DepositState,
  depositStates,
  refundDepositIfOwed,
} from "./reservation-deposit-service";
import {
  expireOverdueReservations,
  getLiveGuestHold,
  lockLocationForBooking,
  releaseExpiredHolds,
} from "./reservation-hold-service";

/*
 * Turning a guest's hold into a reservation (§19). The hold already owns the
 * table, so nothing else can book it; this step attaches the hold to the
 * reservation and decides how long it lasts:
 *   auto confirmation   → confirmed, held until released;
 *   manual confirmation → pending_confirmation, held until the start time
 *                         (unanswered requests expire then).
 */

type Actor = Pick<SessionUser, "id">;

const HOLD_GONE = "Your hold on this time ran out. Pick a time again.";

export async function createReservation(
  actor: Actor,
  input: CreateReservationInput,
  now = new Date(),
): Promise<Reservation> {
  const { holdId, contactName, contactPhone, note } = createReservationSchema.parse(input);

  const { reservation, created } = await db.transaction(async (tx) => {
    // Lock the location first (the same order as placing a hold), then read
    // the hold: a concurrent pick or a double submit waits its turn.
    const [target] = await tx
      .select({ restaurantId: reservationHolds.restaurantId, locationId: diningTables.locationId })
      .from(reservationHolds)
      .innerJoin(diningTables, eq(diningTables.id, reservationHolds.tableId))
      .where(and(eq(reservationHolds.id, holdId), eq(reservationHolds.createdByUserId, actor.id)));
    if (!target) throw new AppError("RESERVATION_UNAVAILABLE", HOLD_GONE);
    await lockLocationForBooking(tx, target.locationId);

    // A double-submitted form gets the reservation the first one made.
    const [made] = await tx
      .select({ reservation: reservations })
      .from(reservationHolds)
      .innerJoin(reservations, eq(reservations.id, reservationHolds.reservationId))
      .where(and(eq(reservationHolds.id, holdId), eq(reservations.customerUserId, actor.id)));
    if (made) return { reservation: made.reservation, created: false };

    const hold = await getLiveGuestHold(tx, actor.id, holdId, now);
    if (!hold || hold.partySize === null) throw new AppError("RESERVATION_UNAVAILABLE", HOLD_GONE);
    const location = await loadBookableLocation(tx, target.restaurantId, target.locationId);
    if (!location?.reservationsEnabled) throw new AppError("RESERVATION_UNAVAILABLE");

    // One table per guest at a time: no overlapping active reservations.
    const [overlapping] = await tx
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.customerUserId, actor.id),
          inArray(reservations.status, [...ACTIVE_RESERVATION_STATUSES]),
          lt(reservations.startsAt, hold.endsAt),
          gt(reservations.endsAt, hold.startsAt),
        ),
      );
    if (overlapping) {
      throw new AppError("CONFLICT", "You already have a reservation at this time.");
    }

    // With a deposit, the booking waits for the payment, holding the table meanwhile.
    const depositMinor = depositFor(location, hold.partySize);
    if (depositMinor > 0 && !paymentsAvailable()) {
      throw new AppError("RESERVATION_UNAVAILABLE", "Deposits can't be paid online right now.");
    }
    const confirmed = depositMinor === 0 && location.confirmation === "auto";
    const status =
      depositMinor > 0 ? "pending_payment" : confirmed ? "confirmed" : "pending_confirmation";
    const holdExpiresAt =
      depositMinor > 0
        ? new Date(now.getTime() + DEPOSIT_PAYMENT_MINUTES * 60_000)
        : confirmed
          ? null
          : hold.startsAt;
    const [reservation] = await tx
      .insert(reservations)
      .values({
        restaurantId: hold.restaurantId,
        locationId: location.id,
        tableId: hold.tableId,
        customerUserId: actor.id,
        partySize: hold.partySize,
        startsAt: hold.startsAt,
        endsAt: hold.endsAt,
        status,
        confirmedAt: confirmed ? now : null,
        depositMinor,
        contactName,
        contactPhone,
        note,
      })
      .returning();

    await tx
      .update(reservationHolds)
      .set({ reservationId: reservation!.id, expiresAt: holdExpiresAt })
      .where(eq(reservationHolds.id, hold.id));

    await recordAudit(tx, {
      actor,
      action: "reservation.created",
      entityType: "reservation",
      entityId: reservation!.id,
      restaurantId: reservation!.restaurantId,
      metadata: {
        status: reservation!.status,
        startsAt: reservation!.startsAt.toISOString(),
        partySize: reservation!.partySize,
        ...(depositMinor > 0 && { depositMinor }),
      },
    });
    return { reservation: reservation!, created: true };
  });

  if (created) {
    await publishReservationEvent({
      type: "RESERVATION_CREATED",
      restaurantId: reservation.restaurantId,
      locationId: reservation.locationId,
      reservationId: reservation.id,
      status: reservation.status,
    });
    await announceReservation("created", reservation.id);
  }
  return reservation;
}

export interface MyReservation {
  id: string;
  status: Reservation["status"];
  startsAt: Date;
  endsAt: Date;
  partySize: number;
  timezone: string;
  restaurantName: string;
  locationName: string;
  addressLine: string;
  city: string;
  cancellationReason: string | null;
  depositMinor: number;
  currency: string;
  refundCutoffHours: number;
  /** Latest state of the deposit payment; null if none was started. */
  deposit: DepositState | null;
}

/** A guest's own reservations, soonest upcoming first, then the past (latest first). */
export async function listMyReservations(actor: Actor, now = new Date()): Promise<MyReservation[]> {
  await expireOverdueReservations({ customerUserId: actor.id }, now);
  const rows = await db
    .select({
      id: reservations.id,
      status: reservations.status,
      startsAt: reservations.startsAt,
      endsAt: reservations.endsAt,
      partySize: reservations.partySize,
      cancellationReason: reservations.cancellationReason,
      depositMinor: reservations.depositMinor,
      currency: restaurants.currency,
      refundCutoffHours: restaurantLocations.reservationRefundCutoffHours,
      timezone: restaurantLocations.timezone,
      restaurantName: restaurants.name,
      locationName: restaurantLocations.name,
      addressLine: restaurantLocations.addressLine,
      city: restaurantLocations.city,
    })
    .from(reservations)
    .innerJoin(restaurants, eq(restaurants.id, reservations.restaurantId))
    .innerJoin(restaurantLocations, eq(restaurantLocations.id, reservations.locationId))
    .where(eq(reservations.customerUserId, actor.id))
    .orderBy(asc(reservations.startsAt))
    .limit(200);
  const deposits = await depositStates(rows.map((r) => r.id));
  const withDeposits = rows.map((r) => ({ ...r, deposit: deposits.get(r.id) ?? null }));
  const upcoming = withDeposits.filter((r) => r.endsAt > now);
  const past = withDeposits.filter((r) => r.endsAt <= now).reverse();
  return [...upcoming, ...past];
}

export interface StaffReservation {
  id: string;
  status: Reservation["status"];
  startsAt: Date;
  endsAt: Date;
  partySize: number;
  tableNumber: string;
  contactName: string;
  contactPhone: string;
  note: string | null;
  createdAt: Date;
  depositMinor: number;
  deposit: DepositState | null;
}

/** A location's reservations starting on a local date, in time order (reservation:read). */
export async function listReservationsForStaff(
  actor: Actor,
  restaurantId: string,
  locationId: string,
  date: string,
  now = new Date(),
): Promise<{ timezone: string; currency: string; reservations: StaffReservation[] }> {
  await authorizeRestaurant(actor.id, restaurantId, "reservation:read");
  const day = calendarDateSchema.parse(date);
  if (!z.uuid().safeParse(locationId).success)
    throw new AppError("NOT_FOUND", "Location not found.");
  const [location] = await db
    .select({ timezone: restaurantLocations.timezone, currency: restaurants.currency })
    .from(restaurantLocations)
    .innerJoin(restaurants, eq(restaurants.id, restaurantLocations.restaurantId))
    .where(
      and(
        eq(restaurantLocations.id, locationId),
        eq(restaurantLocations.restaurantId, restaurantId),
      ),
    );
  if (!location) throw new AppError("NOT_FOUND", "Location not found.");
  await expireOverdueReservations({ locationId }, now);

  const rows = await db
    .select({
      id: reservations.id,
      status: reservations.status,
      startsAt: reservations.startsAt,
      endsAt: reservations.endsAt,
      partySize: reservations.partySize,
      tableNumber: diningTables.number,
      contactName: reservations.contactName,
      contactPhone: reservations.contactPhone,
      note: reservations.note,
      createdAt: reservations.createdAt,
      depositMinor: reservations.depositMinor,
    })
    .from(reservations)
    .innerJoin(diningTables, eq(diningTables.id, reservations.tableId))
    .where(
      and(
        eq(reservations.restaurantId, restaurantId),
        eq(reservations.locationId, locationId),
        gte(reservations.startsAt, zonedTime(day, 0, location.timezone)),
        lt(reservations.startsAt, zonedTime(addDays(day, 1), 0, location.timezone)),
      ),
    )
    .orderBy(asc(reservations.startsAt), asc(diningTables.sortOrder));
  const deposits = await depositStates(rows.map((r) => r.id));
  return {
    timezone: location.timezone,
    currency: location.currency,
    reservations: rows.map((r) => ({ ...r, deposit: deposits.get(r.id) ?? null })),
  };
}

/** Staff actions the guest hears about. */
const ANNOUNCED: Partial<Record<StaffReservationAction, ReservationEvent>> = {
  confirm: "confirmed",
  decline: "declined",
  cancel: "cancelled_by_restaurant",
};

const reasonSchema = z.string().trim().min(3, "reasonTooShort").max(300, "reasonTooLong");

const AUDIT_ACTION: Record<StaffReservationAction, AuditAction> = {
  confirm: "reservation.confirmed",
  decline: "reservation.declined",
  cancel: "reservation.cancelled",
  arrive: "reservation.arrived",
  seat: "reservation.seated",
  complete: "reservation.completed",
  no_show: "reservation.no_show",
};

/** Columns that record when (and by whom) a reservation reached `to`. */
function statusFields(
  to: ReservationStatus,
  current: Reservation,
  actorId: string,
  reason: string | null,
  now: Date,
): Partial<typeof reservations.$inferInsert> {
  switch (to) {
    case "confirmed":
      return { confirmedAt: now };
    case "arrived":
      return { arrivedAt: now };
    case "seated":
      return { seatedAt: now, arrivedAt: current.arrivedAt ?? now };
    case "completed":
      return { completedAt: now };
    case "cancelled":
      return { cancelledAt: now, cancelledByUserId: actorId, cancellationReason: reason };
    case "no_show":
      return { noShowAt: now };
    default:
      return {};
  }
}

/**
 * Move a locked reservation to `to` and adjust its hold: ending statuses
 * give the table back at once; confirming keeps it until released.
 */
async function moveReservation(
  tx: Transaction,
  current: Reservation,
  to: ReservationStatus,
  fields: Partial<typeof reservations.$inferInsert>,
  now: Date,
): Promise<Reservation> {
  const [updated] = await tx
    .update(reservations)
    .set({ status: to, ...fields })
    .where(eq(reservations.id, current.id))
    .returning();
  const live = and(
    eq(reservationHolds.reservationId, current.id),
    isNull(reservationHolds.releasedAt),
  );
  if (FINAL_RESERVATION_STATUSES.includes(to)) {
    await tx.update(reservationHolds).set({ releasedAt: now }).where(live);
  } else if (to === "confirmed") {
    await tx.update(reservationHolds).set({ expiresAt: null }).where(live);
  }
  return updated!;
}

/**
 * Expire the reservation's request if its hold ran out, in its own commit:
 * the expiry job may not have run yet, and refusing the action afterwards
 * must not roll the expiry back.
 */
async function expireIfOverdue(where: SQL | undefined, now: Date) {
  const [found] = await db
    .select({
      tableId: reservations.tableId,
      startsAt: reservations.startsAt,
      endsAt: reservations.endsAt,
    })
    .from(reservations)
    .where(where);
  if (found) {
    await releaseExpiredHolds(db, now, {
      tableIds: [found.tableId],
      from: found.startsAt,
      to: found.endsAt,
    });
  }
}

async function lockReservation(tx: Transaction, where: SQL | undefined) {
  const [current] = await tx.select().from(reservations).where(where).for("update");
  if (!current) throw new AppError("NOT_FOUND", "Reservation not found.");
  return current;
}

/** Staff move a reservation along (§19): confirm, decline, arrive, seat, complete, no-show, cancel. */
export async function updateReservationStatus(
  actor: Actor,
  restaurantId: string,
  reservationId: string,
  action: StaffReservationAction,
  options: { reason?: string } = {},
  now = new Date(),
): Promise<Reservation> {
  if (!STAFF_RESERVATION_ACTIONS.includes(action)) {
    throw new AppError("VALIDATION_ERROR", "Unknown action.");
  }
  const rule = RESERVATION_ACTIONS[action];
  await authorizeRestaurant(actor.id, restaurantId, rule.permission);
  const reason = rule.reasonRequired ? reasonSchema.parse(options.reason ?? "") : null;
  if (!z.uuid().safeParse(reservationId).success) {
    throw new AppError("NOT_FOUND", "Reservation not found.");
  }

  const scope = and(
    eq(reservations.id, reservationId),
    eq(reservations.restaurantId, restaurantId),
  );
  await expireIfOverdue(scope, now);
  const updated = await db.transaction(async (tx) => {
    const current = await lockReservation(tx, scope);
    if (current.status === "expired") {
      throw new AppError("RESERVATION_UNAVAILABLE", "This request expired before it was answered.");
    }
    const blocker = actionBlocker(action, current, now);
    if (blocker === "tooEarly") {
      throw new AppError("CONFLICT", "A no-show can be marked only after the start time.");
    }
    if (blocker) throw new AppError("CONFLICT", "This reservation can't be changed that way now.");

    const updated = await moveReservation(
      tx,
      current,
      rule.to,
      statusFields(rule.to, current, actor.id, reason, now),
      now,
    );
    await recordAudit(tx, {
      actor,
      action: AUDIT_ACTION[action],
      entityType: "reservation",
      entityId: current.id,
      restaurantId,
      metadata: { from: current.status, to: rule.to, ...(reason && { reason }) },
    });
    return updated;
  });

  await publishStatusChange(updated);
  // The restaurant called it off: the guest gets any deposit back.
  await refundDepositIfOwed(updated, "restaurant", now);
  const announced = ANNOUNCED[action];
  if (announced) await announceReservation(announced, updated.id);
  return updated;
}

/** A guest cancels their own booking before it starts; the table is freed at once. */
export async function cancelMyReservation(
  actor: Actor,
  reservationId: string,
  now = new Date(),
): Promise<Reservation> {
  if (!z.uuid().safeParse(reservationId).success) {
    throw new AppError("NOT_FOUND", "Reservation not found.");
  }
  const scope = and(eq(reservations.id, reservationId), eq(reservations.customerUserId, actor.id));
  await expireIfOverdue(scope, now);
  const updated = await db.transaction(async (tx) => {
    const current = await lockReservation(tx, scope);
    if (!canCustomerCancel(current, now)) {
      throw new AppError("CONFLICT", "This reservation can no longer be cancelled online.");
    }
    const updated = await moveReservation(
      tx,
      current,
      "cancelled",
      statusFields("cancelled", current, actor.id, null, now),
      now,
    );
    await recordAudit(tx, {
      actor,
      action: "reservation.cancelled",
      entityType: "reservation",
      entityId: current.id,
      restaurantId: current.restaurantId,
      metadata: { from: current.status, to: "cancelled", by: "guest" },
    });
    return updated;
  });

  await publishStatusChange(updated);
  // Before the location's cutoff, the deposit comes back.
  await refundDepositIfOwed(updated, "guest", now);
  await announceReservation("cancelled_by_guest", updated.id);
  return updated;
}

function publishStatusChange(reservation: Reservation) {
  return publishReservationEvent({
    type: "RESERVATION_STATUS_CHANGED",
    restaurantId: reservation.restaurantId,
    locationId: reservation.locationId,
    reservationId: reservation.id,
    status: reservation.status,
  });
}
