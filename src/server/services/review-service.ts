import "server-only";

import {
  and,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  not,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { createToken, hashToken } from "@/server/crypto/tokens";
import { db, type Executor } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import {
  bills,
  orders,
  reservations,
  restaurantLocations,
  restaurants,
  type Review,
  reviews,
  tableSessionMembers,
  tableSessions,
} from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { hitRateLimit } from "@/server/rate-limit/rate-limit";
import { clientEnv } from "@/shared/config/env.client";
import { MAX_REVIEW_COMMENT, REVIEW_WINDOW_DAYS } from "@/shared/constants/reviews";
import { AppError } from "@/shared/errors";

import { sendEmail } from "./notification-service";

/*
 * Reviews (§24). A review is only possible for something the author really
 * did: a reservation of theirs that was completed, or a table visit where
 * they were a guest, got served, and the visit ended (closed or bill paid) —
 * within REVIEW_WINDOW_DAYS. One review each. New reviews are published at
 * once; admins can hide or reject them afterwards. Anonymous guests must
 * leave an email address (verified once email sending exists, Phase 12).
 */

export const REVIEW_LIMIT = { max: 10, windowMs: 60 * 60_000 };
const SERVED = ["served", "completed"] as const;

export interface ReviewOpportunity {
  subject: "reservation" | "visit";
  /** The reservation id or the table visit id. */
  targetId: string;
  restaurantId: string;
  restaurantName: string;
  locationId: string;
  locationName: string;
  /** When the reservation was completed or the visit ended. */
  visitedAt: Date;
}

const sinceWindow = (now: Date) => new Date(now.getTime() - REVIEW_WINDOW_DAYS * 86_400_000);

const authoredBy = (customer: Customer): SQL =>
  customer.type === "user"
    ? eq(reviews.authorUserId, customer.user.id)
    : eq(reviews.authorGuestId, customer.guest.id);

const memberIs = (customer: Customer): SQL =>
  customer.type === "user"
    ? eq(tableSessionMembers.userId, customer.user.id)
    : eq(tableSessionMembers.guestId, customer.guest.id);

/** Completed reservations of this signed-in guest, not reviewed yet. */
async function reservationOpportunities(
  executor: Executor,
  customer: Customer,
  now: Date,
  only?: string,
): Promise<ReviewOpportunity[]> {
  if (customer.type !== "user") return [];
  const rows = await executor
    .select({
      targetId: reservations.id,
      restaurantId: reservations.restaurantId,
      restaurantName: restaurants.name,
      locationId: reservations.locationId,
      locationName: restaurantLocations.name,
      visitedAt: reservations.completedAt,
    })
    .from(reservations)
    .innerJoin(restaurants, eq(restaurants.id, reservations.restaurantId))
    .innerJoin(restaurantLocations, eq(restaurantLocations.id, reservations.locationId))
    .where(
      and(
        eq(reservations.customerUserId, customer.user.id),
        eq(reservations.status, "completed"),
        gte(reservations.completedAt, sinceWindow(now)),
        only ? eq(reservations.id, only) : undefined,
        // Not reviewed yet.
        not(
          exists(
            executor
              .select({ id: reviews.id })
              .from(reviews)
              .where(eq(reviews.reservationId, reservations.id)),
          ),
        ),
      ),
    )
    .orderBy(desc(reservations.completedAt));
  return rows.map((r) => ({ ...r, subject: "reservation" as const, visitedAt: r.visitedAt! }));
}

/** Ended table visits where this guest was served, not reviewed by them yet. */
async function visitOpportunities(
  executor: Executor,
  customer: Customer,
  now: Date,
  only?: string,
): Promise<ReviewOpportunity[]> {
  const since = sinceWindow(now);
  const rows = await executor
    .selectDistinct({
      targetId: tableSessions.id,
      restaurantId: tableSessions.restaurantId,
      restaurantName: restaurants.name,
      closedAt: tableSessions.closedAt,
      paidAt: bills.paidAt,
      locationId: restaurantLocations.id,
      locationName: restaurantLocations.name,
    })
    .from(tableSessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, tableSessionMembers.sessionId))
    .innerJoin(restaurants, eq(restaurants.id, tableSessions.restaurantId))
    .innerJoin(orders, eq(orders.memberId, tableSessionMembers.id))
    .innerJoin(restaurantLocations, eq(restaurantLocations.id, orders.locationId))
    .leftJoin(bills, and(eq(bills.tableSessionId, tableSessions.id), eq(bills.status, "paid")))
    .where(
      and(
        memberIs(customer),
        inArray(orders.status, [...SERVED]),
        // The visit ended: closed, or its bill paid.
        or(
          and(isNotNull(tableSessions.closedAt), gte(tableSessions.closedAt, since)),
          and(isNotNull(bills.paidAt), gte(bills.paidAt, since)),
        ),
        only ? eq(tableSessions.id, only) : undefined,
        not(
          exists(
            executor
              .select({ id: reviews.id })
              .from(reviews)
              .where(and(eq(reviews.tableSessionId, tableSessions.id), authoredBy(customer))),
          ),
        ),
      ),
    );
  return rows.map(({ closedAt, paidAt, ...r }) => ({
    ...r,
    subject: "visit" as const,
    visitedAt: (paidAt && closedAt
      ? paidAt < closedAt
        ? paidAt
        : closedAt
      : (paidAt ?? closedAt))!,
  }));
}

/** What this guest may review now, latest first. */
export async function listReviewOpportunities(
  customer: Customer,
  now = new Date(),
): Promise<ReviewOpportunity[]> {
  const [booked, visited] = await Promise.all([
    reservationOpportunities(db, customer, now),
    visitOpportunities(db, customer, now),
  ]);
  return [...booked, ...visited].sort((a, b) => b.visitedAt.getTime() - a.visitedAt.getTime());
}

const reviewInputSchema = z.object({
  subject: z.enum(["reservation", "visit"]),
  targetId: z.uuid(),
  rating: z.number("ratingRequired").int().min(1, "ratingRequired").max(5, "ratingRequired"),
  comment: z
    .string()
    .trim()
    .max(MAX_REVIEW_COMMENT, "commentTooLong")
    .transform((v) => (v === "" ? null : v))
    .nullish(),
  /** Anonymous guests: required. */
  email: z
    .union([z.literal(""), z.email("emailInvalid").max(200)])
    .transform((v) => (v === "" ? null : v.toLowerCase()))
    .nullish(),
  /** Language of the verification email for anonymous guests. */
  locale: z.enum(["hy", "en"]).catch("hy").optional(),
  /** Anonymous guests: optional name to show ("Guest" otherwise). */
  displayName: z
    .string()
    .trim()
    .max(60, "nameTooLong")
    .transform((v) => (v === "" ? null : v))
    .nullish(),
});

export type ReviewInput = z.input<typeof reviewInputSchema>;

/** Publish a review of something the author really did (§24). */
export async function createReview(
  customer: Customer,
  input: ReviewInput,
  now = new Date(),
): Promise<Review> {
  const data = reviewInputSchema.parse(input);
  if (customer.type === "guest" && !data.email) {
    throw new AppError("VALIDATION_ERROR", "Please leave your email address.", {
      fieldErrors: { email: ["emailRequired"] },
    });
  }
  const who = customer.type === "user" ? customer.user.id : customer.guest.id;
  if (!(await hitRateLimit(`review:${who}`, REVIEW_LIMIT)).allowed) {
    throw new AppError("RATE_LIMITED");
  }

  // Anonymous authors confirm their email through a link; only its hash is kept.
  const token = customer.type === "guest" ? createToken() : null;
  const review = await db.transaction(async (tx) => {
    const [opportunity] =
      data.subject === "reservation"
        ? await reservationOpportunities(tx, customer, now, data.targetId)
        : await visitOpportunities(tx, customer, now, data.targetId);
    if (!opportunity) {
      throw new AppError("NOT_FOUND", "You can only review your own recent, completed visits.");
    }
    try {
      const [review] = await tx
        .insert(reviews)
        .values({
          restaurantId: opportunity.restaurantId,
          locationId: opportunity.locationId,
          subject: data.subject,
          reservationId: data.subject === "reservation" ? data.targetId : null,
          tableSessionId: data.subject === "visit" ? data.targetId : null,
          authorUserId: customer.type === "user" ? customer.user.id : null,
          authorGuestId: customer.type === "guest" ? customer.guest.id : null,
          authorEmail: customer.type === "guest" ? data.email : null,
          emailTokenHash: token ? hashToken(token) : null,
          displayName:
            customer.type === "user"
              ? customer.user.name?.trim() || "Guest"
              : (data.displayName ?? "Guest"),
          rating: data.rating,
          comment: data.comment ?? null,
          status: "published",
          publishedAt: now,
        })
        .returning();
      return review!;
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError("CONFLICT", "You've already reviewed this.");
      throw error;
    }
  });
  if (token && review.authorEmail) {
    const locale = data.locale ?? "hy";
    const [restaurant] = await db
      .select({ name: restaurants.name })
      .from(restaurants)
      .where(eq(restaurants.id, review.restaurantId));
    const base = clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
    await sendEmail({
      to: review.authorEmail,
      template: "review_verify",
      locale,
      values: {
        name: review.displayName === "Guest" ? "" : review.displayName,
        restaurant: restaurant?.name ?? "",
      },
      action: { url: `${base}${locale === "hy" ? "" : `/${locale}`}/reviews/verify/${token}` },
    });
  }
  return review;
}

/** The link in the verification email: marks the author's email as confirmed. */
export async function verifyReviewEmail(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
  const confirmed = await db
    .update(reviews)
    .set({ authorEmailVerifiedAt: new Date(), emailTokenHash: null })
    .where(eq(reviews.emailTokenHash, hashToken(token)))
    .returning({ id: reviews.id });
  return confirmed.length > 0;
}

export interface PublicReview {
  id: string;
  displayName: string;
  rating: number;
  comment: string | null;
  publishedAt: Date;
  response: string | null;
  respondedAt: Date | null;
}

/** A restaurant's public rating: average, count and the latest published reviews. */
export async function getReviewSummary(
  restaurantId: string,
  limit = 5,
): Promise<{ average: number | null; count: number; recent: PublicReview[] }> {
  const published = and(eq(reviews.restaurantId, restaurantId), eq(reviews.status, "published"));
  const [[totals], recent] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)::int`,
        average: sql<number | null>`round(avg(${reviews.rating}), 1)::float`,
      })
      .from(reviews)
      .where(published),
    db
      .select({
        id: reviews.id,
        displayName: reviews.displayName,
        rating: reviews.rating,
        comment: reviews.comment,
        publishedAt: reviews.publishedAt,
        response: reviews.response,
        respondedAt: reviews.respondedAt,
      })
      .from(reviews)
      .where(published)
      .orderBy(desc(reviews.publishedAt))
      .limit(limit),
  ]);
  return {
    average: totals!.average,
    count: totals!.count,
    recent: recent.map((r) => ({ ...r, publishedAt: r.publishedAt! })),
  };
}

/** A signed-in author's own reviews, latest first. */
export async function listMyReviews(actor: { id: string }) {
  return db
    .select({
      id: reviews.id,
      restaurantName: restaurants.name,
      rating: reviews.rating,
      comment: reviews.comment,
      status: reviews.status,
      createdAt: reviews.createdAt,
      response: reviews.response,
    })
    .from(reviews)
    .innerJoin(restaurants, eq(restaurants.id, reviews.restaurantId))
    .where(eq(reviews.authorUserId, actor.id))
    .orderBy(desc(reviews.createdAt));
}

const editSchema = reviewInputSchema.pick({ rating: true, comment: true });

/** Authors edit their own review (signed-in only); hidden or rejected ones stay as they are. */
export async function updateMyReview(
  actor: { id: string },
  reviewId: string,
  input: z.input<typeof editSchema>,
): Promise<Review> {
  const data = editSchema.parse(input);
  if (!z.uuid().safeParse(reviewId).success) throw new AppError("NOT_FOUND", "Review not found.");
  const [updated] = await db
    .update(reviews)
    .set({ rating: data.rating, comment: data.comment ?? null })
    .where(
      and(
        eq(reviews.id, reviewId),
        eq(reviews.authorUserId, actor.id),
        inArray(reviews.status, ["pending", "published"]),
      ),
    )
    .returning();
  if (!updated) throw new AppError("NOT_FOUND", "Review not found.");
  return updated;
}

/** Authors delete their own review (signed-in only). */
export async function deleteMyReview(actor: { id: string }, reviewId: string) {
  if (!z.uuid().safeParse(reviewId).success) throw new AppError("NOT_FOUND", "Review not found.");
  const deleted = await db
    .delete(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.authorUserId, actor.id)))
    .returning({ id: reviews.id });
  if (deleted.length === 0) throw new AppError("NOT_FOUND", "Review not found.");
}
