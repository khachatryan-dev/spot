import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import {
  billPayments,
  paymentEvents,
  paymentRefunds,
  payments,
  restaurants,
} from "@/server/db/schema";
import { authorizePlatform } from "@/server/policies/restaurant-access";
import { PAYMENT_STATUSES, type PaymentStatus } from "@/shared/constants/payments";
import { AppError } from "@/shared/errors";

/*
 * Payment monitoring for platform admins (platform:payments:read): every
 * payment with its history, totals for a period, and the things that need a
 * human — amount mismatches, failed or stuck refunds, payments that never
 * got an answer from the provider. Read-only.
 */

type Admin = Pick<SessionUser, "platformRole">;
/** Older than this without an answer counts as stuck. */
export const STUCK_AFTER_MS = 60 * 60_000;

export const paymentFilterSchema = z.object({
  status: z.enum(PAYMENT_STATUSES).optional().catch(undefined),
  restaurant: z.uuid().optional().catch(undefined),
  from: z.coerce.date().optional().catch(undefined),
  to: z.coerce.date().optional().catch(undefined),
});
export type PaymentFilter = z.output<typeof paymentFilterSchema>;

const filterWhere = (f: PaymentFilter): SQL | undefined =>
  and(
    f.status ? eq(payments.status, f.status) : undefined,
    f.restaurant ? eq(payments.restaurantId, f.restaurant) : undefined,
    f.from ? gte(payments.createdAt, f.from) : undefined,
    // "to" is a calendar day: include all of it.
    f.to ? lt(payments.createdAt, new Date(f.to.getTime() + 86_400_000)) : undefined,
  );

export interface AdminPaymentRow {
  id: string;
  restaurantId: string;
  restaurantName: string;
  purpose: "reservation_deposit" | "bill";
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  status: PaymentStatus;
  provider: string;
  failureReason: string | null;
  createdAt: Date;
}

const rowColumns = {
  id: payments.id,
  restaurantId: payments.restaurantId,
  restaurantName: restaurants.name,
  purpose: payments.purpose,
  amountMinor: payments.amountMinor,
  refundedMinor: payments.refundedMinor,
  currency: payments.currency,
  status: payments.status,
  provider: payments.provider,
  failureReason: payments.failureReason,
  createdAt: payments.createdAt,
};

export async function listPayments(admin: Admin, filter: PaymentFilter, limit = 100) {
  authorizePlatform(admin, "platform:payments:read");
  return db
    .select(rowColumns)
    .from(payments)
    .innerJoin(restaurants, eq(restaurants.id, payments.restaurantId))
    .where(filterWhere(filter))
    .orderBy(desc(payments.createdAt))
    .limit(Math.min(limit, 500));
}

export interface PaymentTotals {
  currency: string;
  /** Money taken (succeeded, including later refunds). */
  paidMinor: number;
  refundedMinor: number;
  paidCount: number;
  failedCount: number;
  pendingCount: number;
}

/** Totals per currency for the filtered payments. */
export async function paymentTotals(admin: Admin, filter: PaymentFilter): Promise<PaymentTotals[]> {
  authorizePlatform(admin, "platform:payments:read");
  const taken = sql`${payments.status} IN ('succeeded', 'partially_refunded', 'refunded')`;
  return db
    .select({
      currency: payments.currency,
      paidMinor: sql<number>`coalesce(sum(${payments.amountMinor}) FILTER (WHERE ${taken}), 0)::int`,
      refundedMinor: sql<number>`coalesce(sum(${payments.refundedMinor}), 0)::int`,
      paidCount: sql<number>`count(*) FILTER (WHERE ${taken})::int`,
      failedCount: sql<number>`count(*) FILTER (WHERE ${payments.status} = 'failed')::int`,
      pendingCount: sql<number>`count(*) FILTER (WHERE ${payments.status} IN ('pending', 'processing'))::int`,
    })
    .from(payments)
    .where(filterWhere(filter))
    .groupBy(payments.currency)
    .orderBy(payments.currency);
}

export interface PaymentProblem {
  kind: "amount_mismatch" | "refund_failed" | "refund_stuck" | "payment_stuck";
  paymentId: string;
  restaurantName: string;
  amountMinor: number;
  currency: string;
  at: Date;
}

/** What needs a human, oldest first. */
export async function listPaymentProblems(
  admin: Admin,
  now = new Date(),
): Promise<PaymentProblem[]> {
  authorizePlatform(admin, "platform:payments:read");
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  const base = {
    paymentId: payments.id,
    restaurantName: restaurants.name,
    currency: payments.currency,
  };
  const [mismatches, failedRefunds, stuckRefunds, stuckPayments] = await Promise.all([
    db
      .selectDistinctOn([payments.id], {
        ...base,
        amountMinor: payments.amountMinor,
        at: paymentEvents.createdAt,
      })
      .from(paymentEvents)
      .innerJoin(payments, eq(payments.id, paymentEvents.paymentId))
      .innerJoin(restaurants, eq(restaurants.id, payments.restaurantId))
      .where(eq(paymentEvents.type, "amount_mismatch"))
      .orderBy(payments.id, desc(paymentEvents.createdAt)),
    db
      .select({ ...base, amountMinor: paymentRefunds.amountMinor, at: paymentRefunds.createdAt })
      .from(paymentRefunds)
      .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
      .innerJoin(restaurants, eq(restaurants.id, payments.restaurantId))
      .where(eq(paymentRefunds.status, "failed")),
    db
      .select({ ...base, amountMinor: paymentRefunds.amountMinor, at: paymentRefunds.createdAt })
      .from(paymentRefunds)
      .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
      .innerJoin(restaurants, eq(restaurants.id, payments.restaurantId))
      .where(and(eq(paymentRefunds.status, "pending"), lte(paymentRefunds.createdAt, stuckBefore))),
    db
      .select({ ...base, amountMinor: payments.amountMinor, at: payments.createdAt })
      .from(payments)
      .innerJoin(restaurants, eq(restaurants.id, payments.restaurantId))
      .where(
        and(
          inArray(payments.status, ["pending", "processing"]),
          isNotNull(payments.providerPaymentId),
          lte(payments.createdAt, stuckBefore),
        ),
      ),
  ]);
  return [
    ...mismatches.map((p) => ({ ...p, kind: "amount_mismatch" as const })),
    ...failedRefunds.map((p) => ({ ...p, kind: "refund_failed" as const })),
    ...stuckRefunds.map((p) => ({ ...p, kind: "refund_stuck" as const })),
    ...stuckPayments.map((p) => ({ ...p, kind: "payment_stuck" as const })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** One payment with its full history, refunds and what it paid for. */
export async function getPaymentDetail(admin: Admin, paymentId: string) {
  authorizePlatform(admin, "platform:payments:read");
  if (!z.uuid().safeParse(paymentId).success) throw new AppError("NOT_FOUND", "Payment not found.");
  const [payment] = await db
    .select({
      ...rowColumns,
      providerPaymentId: payments.providerPaymentId,
      reservationId: payments.reservationId,
      succeededAt: payments.succeededAt,
    })
    .from(payments)
    .innerJoin(restaurants, eq(restaurants.id, payments.restaurantId))
    .where(eq(payments.id, paymentId));
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");
  const [events, refunds, [bill]] = await Promise.all([
    db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.paymentId, paymentId))
      .orderBy(asc(paymentEvents.createdAt)),
    db
      .select()
      .from(paymentRefunds)
      .where(eq(paymentRefunds.paymentId, paymentId))
      .orderBy(asc(paymentRefunds.createdAt)),
    db
      .select({ billId: billPayments.billId })
      .from(billPayments)
      .where(eq(billPayments.paymentId, paymentId)),
  ]);
  return { payment, events, refunds, billId: bill?.billId ?? null };
}
