import "server-only";

import { and, avg, count, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import {
  bills,
  type CustomerReview,
  customerReviews,
  orders,
  reservations,
  restaurants,
  tableSessionMembers,
  tableSessions,
  users,
} from "@/server/db/schema";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import {
  CUSTOMER_REVIEW_WINDOW_DAYS,
  MAX_CUSTOMER_REVIEW_COMMENT,
} from "@/shared/constants/customer-reviews";
import { AppError } from "@/shared/errors";

/*
 * Two-way reviews: a restaurant rates a signed-in customer after a real visit
 * — a completed or no-show reservation, or an ended table visit where they
 * were served — within CUSTOMER_REVIEW_WINDOW_DAYS. Only that restaurant's
 * team and the customer ever see it. Saving again edits it; each save is audited.
 */

type Actor = Pick<SessionUser, "id">;

export type CustomerReviewTarget =
  | { subject: "reservation"; reservationId: string }
  | { subject: "visit"; tableSessionId: string; customerUserId: string };

export const customerReviewSchema = z.object({
  rating: z.int("ratingRequired").min(1, "ratingRequired").max(5, "ratingRequired"),
  comment: z
    .string()
    .trim()
    .max(MAX_CUSTOMER_REVIEW_COMMENT, "commentTooLong")
    .transform((v) => (v === "" ? null : v))
    .nullish(),
});
export type CustomerReviewInput = z.input<typeof customerReviewSchema>;

const SERVED = ["served", "completed"] as const;
const isUuid = (value: string) => z.uuid().safeParse(value).success;
const notFound = () => new AppError("NOT_FOUND", "Visit not found.");

/** Who is rated, after checking the visit is real, theirs, ended and recent. */
async function resolveTarget(
  restaurantId: string,
  target: CustomerReviewTarget,
  now: Date,
): Promise<{
  customerUserId: string;
  reservationId: string | null;
  tableSessionId: string | null;
}> {
  const since = new Date(now.getTime() - CUSTOMER_REVIEW_WINDOW_DAYS * 86_400_000);
  const tooLate = () =>
    new AppError("CONFLICT", "It's too late to rate this visit.", {
      fieldErrors: { rating: ["tooLateToRate"] },
    });

  if (target.subject === "reservation") {
    if (!isUuid(target.reservationId)) throw notFound();
    const [r] = await db
      .select({
        status: reservations.status,
        customerUserId: reservations.customerUserId,
        completedAt: reservations.completedAt,
        noShowAt: reservations.noShowAt,
      })
      .from(reservations)
      .where(
        and(eq(reservations.id, target.reservationId), eq(reservations.restaurantId, restaurantId)),
      );
    if (!r || !r.customerUserId) throw notFound();
    const endedAt =
      r.status === "completed" ? r.completedAt : r.status === "no_show" ? r.noShowAt : null;
    if (!endedAt) throw new AppError("CONFLICT", "Rate a guest after the booking is over.");
    if (endedAt < since) throw tooLate();
    return {
      customerUserId: r.customerUserId,
      reservationId: target.reservationId,
      tableSessionId: null,
    };
  }

  if (!isUuid(target.tableSessionId) || !isUuid(target.customerUserId)) throw notFound();
  const [visit] = await db
    .select({ closedAt: tableSessions.closedAt, paidAt: bills.paidAt })
    .from(tableSessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, tableSessionMembers.sessionId))
    .innerJoin(orders, eq(orders.memberId, tableSessionMembers.id))
    .leftJoin(bills, and(eq(bills.tableSessionId, tableSessions.id), eq(bills.status, "paid")))
    .where(
      and(
        eq(tableSessions.id, target.tableSessionId),
        eq(tableSessions.restaurantId, restaurantId),
        eq(tableSessionMembers.userId, target.customerUserId),
        inArray(orders.status, [...SERVED]),
      ),
    )
    .limit(1);
  if (!visit) throw notFound();
  const endedAt = visit.closedAt ?? visit.paidAt;
  if (!endedAt) throw new AppError("CONFLICT", "Rate guests after the visit has ended.");
  if (endedAt < since) throw tooLate();
  return {
    customerUserId: target.customerUserId,
    reservationId: null,
    tableSessionId: target.tableSessionId,
  };
}

/** Rate a customer (customer:rate), or change the rating already given for that visit. */
export async function rateCustomer(
  actor: Actor,
  restaurantId: string,
  target: CustomerReviewTarget,
  input: CustomerReviewInput,
  now = new Date(),
): Promise<CustomerReview> {
  await authorizeRestaurant(actor.id, restaurantId, "customer:rate");
  const { rating, comment } = customerReviewSchema.parse(input);
  const who = await resolveTarget(restaurantId, target, now);

  return db.transaction(async (tx) => {
    const values = {
      restaurantId,
      subject: target.subject,
      ...who,
      rating,
      comment: comment ?? null,
      authorUserId: actor.id,
    };
    const set = { rating, comment: comment ?? null, authorUserId: actor.id, updatedAt: now };
    const [saved] =
      target.subject === "reservation"
        ? await tx
            .insert(customerReviews)
            .values(values)
            .onConflictDoUpdate({
              target: customerReviews.reservationId,
              targetWhere: sql`${customerReviews.reservationId} IS NOT NULL`,
              set,
            })
            .returning()
        : await tx
            .insert(customerReviews)
            .values(values)
            .onConflictDoUpdate({
              target: [customerReviews.tableSessionId, customerReviews.customerUserId],
              targetWhere: sql`${customerReviews.tableSessionId} IS NOT NULL`,
              set,
            })
            .returning();
    await recordAudit(tx, {
      actor,
      action: "customer_review.saved",
      entityType: "customer_review",
      entityId: saved!.id,
      restaurantId,
      metadata: { rating, subject: target.subject, customerUserId: who.customerUserId },
    });
    return saved!;
  });
}

export interface CustomerRatingSummary {
  average: number;
  count: number;
}

/** This restaurant's own past ratings of these customers (never other restaurants'). */
export async function summarizeCustomerRatings(
  actor: Actor,
  restaurantId: string,
  customerUserIds: string[],
): Promise<Map<string, CustomerRatingSummary>> {
  await authorizeRestaurant(actor.id, restaurantId, "reservation:read");
  const ids = [...new Set(customerUserIds)].filter(isUuid);
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      customerUserId: customerReviews.customerUserId,
      average: avg(customerReviews.rating).mapWith(Number),
      count: count(),
    })
    .from(customerReviews)
    .where(
      and(
        eq(customerReviews.restaurantId, restaurantId),
        inArray(customerReviews.customerUserId, ids),
      ),
    )
    .groupBy(customerReviews.customerUserId);
  return new Map(rows.map((r) => [r.customerUserId, { average: r.average, count: r.count }]));
}

/** The ratings this restaurant already gave for these reservations / visits, for editing. */
export async function listGivenRatings(
  actor: Actor,
  restaurantId: string,
  filter: { reservationIds?: string[]; tableSessionIds?: string[] },
): Promise<CustomerReview[]> {
  await authorizeRestaurant(actor.id, restaurantId, "customer:rate");
  const reservationIds = (filter.reservationIds ?? []).filter(isUuid);
  const sessionIds = (filter.tableSessionIds ?? []).filter(isUuid);
  if (reservationIds.length === 0 && sessionIds.length === 0) return [];
  return db
    .select()
    .from(customerReviews)
    .where(
      and(
        eq(customerReviews.restaurantId, restaurantId),
        or(
          reservationIds.length
            ? inArray(customerReviews.reservationId, reservationIds)
            : undefined,
          sessionIds.length ? inArray(customerReviews.tableSessionId, sessionIds) : undefined,
        ),
      ),
    );
}

export interface MyCustomerReview {
  id: string;
  restaurantName: string;
  subject: CustomerReview["subject"];
  rating: number;
  comment: string | null;
  updatedAt: Date;
}

/** What restaurants said about this customer, newest first (shown in their profile). */
export async function listMyCustomerReviews(actor: Actor): Promise<MyCustomerReview[]> {
  return db
    .select({
      id: customerReviews.id,
      restaurantName: restaurants.name,
      subject: customerReviews.subject,
      rating: customerReviews.rating,
      comment: customerReviews.comment,
      updatedAt: customerReviews.updatedAt,
    })
    .from(customerReviews)
    .innerJoin(restaurants, eq(restaurants.id, customerReviews.restaurantId))
    .where(eq(customerReviews.customerUserId, actor.id))
    .orderBy(desc(customerReviews.updatedAt))
    .limit(100);
}

/** Signed-in customers who were served at this visit (whom the restaurant can rate). */
export async function listRateableVisitors(
  actor: Actor,
  restaurantId: string,
  tableSessionId: string,
): Promise<{ userId: string; name: string }[]> {
  await authorizeRestaurant(actor.id, restaurantId, "customer:rate");
  if (!isUuid(tableSessionId)) return [];
  return db
    .selectDistinct({
      userId: users.id,
      name: sql<string>`coalesce(${users.name}, ${users.email})`,
    })
    .from(tableSessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, tableSessionMembers.sessionId))
    .innerJoin(users, eq(users.id, tableSessionMembers.userId))
    .innerJoin(orders, eq(orders.memberId, tableSessionMembers.id))
    .where(
      and(
        eq(tableSessions.id, tableSessionId),
        eq(tableSessions.restaurantId, restaurantId),
        isNotNull(tableSessionMembers.userId),
        inArray(orders.status, [...SERVED]),
      ),
    );
}
