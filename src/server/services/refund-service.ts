import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { type Payment, type PaymentRefund, paymentRefunds, payments } from "@/server/db/schema";
import { logger } from "@/server/logger";
import { paymentProviderNamed } from "@/server/payments/registry";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { isPaid, statusAfterRefund } from "@/shared/domain/payment-status";
import { AppError } from "@/shared/errors";

import { announceRefund } from "./payment-notices";
import { recordPaymentEvent } from "./payment-service";

/*
 * Refunds (§21). Three steps, so money is never refunded twice or beyond
 * what was paid:
 *   1. reserve: under a lock on the payment, check the amount still
 *      refundable (counting refunds in flight) and record a pending refund;
 *   2. ask the provider, with the refund's idempotency key;
 *   3. record the outcome; only a successful refund changes the payment.
 */

type Actor = Pick<SessionUser, "id">;
const log = logger.child({ module: "refunds" });

const refundSchema = z.object({
  amountMinor: z.number().int().positive("amountInvalid"),
  reason: z.string().trim().min(3, "reasonTooShort").max(300, "reasonTooLong"),
  /** Generated when the refund form opens; a resubmit reuses it. */
  idempotencyKey: z.string().min(8).max(200),
});

export type RefundInput = z.input<typeof refundSchema>;

/** Staff refund (payment:refund). */
export async function refundPayment(
  actor: Actor,
  restaurantId: string,
  paymentId: string,
  input: RefundInput,
): Promise<{ refund: PaymentRefund; payment: Payment }> {
  await authorizeRestaurant(actor.id, restaurantId, "payment:refund");
  return performRefund(actor, restaurantId, paymentId, input);
}

/**
 * A refund the platform owes by its own rules (e.g. a deposit for a booking
 * cancelled in time). No person acts; the audit entry has no actor.
 */
export function refundPaymentAutomatically(
  restaurantId: string,
  paymentId: string,
  input: RefundInput,
): Promise<{ refund: PaymentRefund; payment: Payment }> {
  return performRefund(null, restaurantId, paymentId, input);
}

async function performRefund(
  actor: Actor | null,
  restaurantId: string,
  paymentId: string,
  input: RefundInput,
): Promise<{ refund: PaymentRefund; payment: Payment }> {
  const data = refundSchema.parse(input);
  if (!z.uuid().safeParse(paymentId).success) throw new AppError("NOT_FOUND", "Payment not found.");

  // 1. Reserve the amount (or pick up the earlier attempt with this key).
  const { refund, payment } = await db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.restaurantId, restaurantId)))
      .for("update");
    if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");

    const [earlier] = await tx
      .select()
      .from(paymentRefunds)
      .where(eq(paymentRefunds.idempotencyKey, data.idempotencyKey));
    if (earlier) {
      if (earlier.paymentId !== payment.id || earlier.amountMinor !== data.amountMinor) {
        throw new AppError("CONFLICT", "This refund was already requested with different terms.");
      }
      return { refund: earlier, payment };
    }

    if (!isPaid(payment.status)) {
      throw new AppError("CONFLICT", "Only a paid payment can be refunded.");
    }
    const [{ inFlight }] = (await tx
      .select({ inFlight: sql<number>`coalesce(sum(${paymentRefunds.amountMinor}), 0)::int` })
      .from(paymentRefunds)
      .where(
        and(eq(paymentRefunds.paymentId, payment.id), eq(paymentRefunds.status, "pending")),
      )) as [{ inFlight: number }];
    if (payment.refundedMinor + inFlight + data.amountMinor > payment.amountMinor) {
      throw new AppError("CONFLICT", "That's more than is left to refund on this payment.", {
        fieldErrors: { amountMinor: ["refundTooLarge"] },
      });
    }

    const [refund] = await tx
      .insert(paymentRefunds)
      .values({
        paymentId: payment.id,
        restaurantId,
        amountMinor: data.amountMinor,
        reason: data.reason,
        idempotencyKey: data.idempotencyKey,
        requestedByUserId: actor?.id ?? null,
      })
      .returning();
    await recordPaymentEvent(tx, payment, {
      type: "refund_requested",
      fromStatus: payment.status,
      amountMinor: data.amountMinor,
      details: { refundId: refund!.id },
    });
    return { refund: refund!, payment };
  });
  if (refund.status !== "pending") return { refund, payment };

  // 2. Ask the provider. The same key means a retry never refunds twice.
  let result;
  try {
    result = await paymentProviderNamed(payment.provider).refundPayment({
      providerPaymentId: payment.providerPaymentId!,
      amountMinor: refund.amountMinor,
      idempotencyKey: refund.idempotencyKey,
    });
  } catch (error) {
    log.error("Refund call failed", { err: error, paymentId, refundId: refund.id });
    throw new AppError(
      "RESOURCE_UNAVAILABLE",
      "The payment provider didn't answer. Try again — it won't refund twice.",
      { cause: error },
    );
  }
  if (result.status === "processing") {
    await db
      .update(paymentRefunds)
      .set({ providerRefundId: result.providerRefundId })
      .where(eq(paymentRefunds.id, refund.id));
    return { refund: { ...refund, providerRefundId: result.providerRefundId }, payment };
  }

  // 3. Record the outcome; a concurrent retry may already have.
  const outcome: "succeeded" | "failed" = result.status;
  const providerRefundId = result.providerRefundId;
  let succeeded = false;
  const recorded = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, payment.id))
      .for("update");
    const [finished] = await tx
      .update(paymentRefunds)
      .set({
        status: outcome,
        providerRefundId,
        completedAt: new Date(),
      })
      .where(and(eq(paymentRefunds.id, refund.id), eq(paymentRefunds.status, "pending")))
      .returning();
    if (!finished) {
      const [done] = await tx.select().from(paymentRefunds).where(eq(paymentRefunds.id, refund.id));
      return { refund: done!, payment: current! };
    }

    if (outcome === "failed") {
      await recordPaymentEvent(tx, current!, {
        type: "refund_failed",
        fromStatus: current!.status,
        amountMinor: refund.amountMinor,
        details: { refundId: refund.id },
      });
      await recordAudit(tx, {
        actor,
        action: "payment.refund_failed",
        entityType: "payment",
        entityId: payment.id,
        restaurantId,
        metadata: { refundId: refund.id, amountMinor: refund.amountMinor },
      });
      return { refund: finished, payment: current! };
    }

    const refundedMinor = current!.refundedMinor + refund.amountMinor;
    const status = statusAfterRefund(current!.amountMinor, refundedMinor);
    const [updated] = await tx
      .update(payments)
      .set({ refundedMinor, status })
      .where(eq(payments.id, payment.id))
      .returning();
    await recordPaymentEvent(tx, current!, {
      type: "refunded",
      fromStatus: current!.status,
      toStatus: status,
      amountMinor: refund.amountMinor,
      details: { refundId: refund.id, providerRefundId },
    });
    await recordAudit(tx, {
      actor,
      action: "payment.refunded",
      entityType: "payment",
      entityId: payment.id,
      restaurantId,
      metadata: {
        refundId: refund.id,
        amountMinor: refund.amountMinor,
        refundedMinor,
        reason: refund.reason,
      },
    });
    succeeded = true;
    return { refund: finished, payment: updated! };
  });
  // Only the request that completed the refund tells the guest.
  if (succeeded) await announceRefund(recorded.payment, refund.amountMinor);
  return recorded;
}
