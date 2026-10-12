import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { restaurantLocations, restaurants, type Review, reviews } from "@/server/db/schema";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { MAX_REVIEW_COMMENT } from "@/shared/constants/reviews";
import { AppError } from "@/shared/errors";

import { notify } from "./notification-service";

/*
 * Reviews from the restaurant's side (§24 "Restaurant can respond"):
 * owners and managers (review:respond) read every review of their
 * restaurant, reply in public, and report unfair ones to the platform's
 * moderators. Reporting never hides a review — only an admin can.
 */

type Actor = Pick<SessionUser, "id">;

const responseSchema = z
  .string()
  .trim()
  .max(MAX_REVIEW_COMMENT, "commentTooLong")
  .transform((v) => (v === "" ? null : v));
const reportReasonSchema = z.string().trim().min(10, "reasonTooShort").max(500, "reasonTooLong");

export interface RestaurantReview {
  id: string;
  subject: Review["subject"];
  locationName: string;
  displayName: string;
  rating: number;
  comment: string | null;
  status: Review["status"];
  createdAt: Date;
  response: string | null;
  respondedAt: Date | null;
  reportedAt: Date | null;
  moderationReason: string | null;
}

/** All of a restaurant's reviews, newest first, with the published average. */
export async function listRestaurantReviews(
  actor: Actor,
  restaurantId: string,
): Promise<{ average: number | null; count: number; reviews: RestaurantReview[] }> {
  await authorizeRestaurant(actor.id, restaurantId, "review:respond");
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: reviews.id,
        subject: reviews.subject,
        locationName: restaurantLocations.name,
        displayName: reviews.displayName,
        rating: reviews.rating,
        comment: reviews.comment,
        status: reviews.status,
        createdAt: reviews.createdAt,
        response: reviews.response,
        respondedAt: reviews.respondedAt,
        reportedAt: reviews.reportedAt,
        moderationReason: reviews.moderationReason,
      })
      .from(reviews)
      .innerJoin(restaurantLocations, eq(restaurantLocations.id, reviews.locationId))
      .where(eq(reviews.restaurantId, restaurantId))
      .orderBy(desc(reviews.createdAt))
      .limit(200),
    db
      .select({
        count: sql<number>`count(*)::int`,
        average: sql<number | null>`round(avg(${reviews.rating}), 1)::float`,
      })
      .from(reviews)
      .where(and(eq(reviews.restaurantId, restaurantId), eq(reviews.status, "published"))),
  ]);
  return { average: totals!.average, count: totals!.count, reviews: rows };
}

async function findReview(restaurantId: string, reviewId: string) {
  if (!z.uuid().safeParse(reviewId).success) throw new AppError("NOT_FOUND", "Review not found.");
  const [review] = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.restaurantId, restaurantId)));
  if (!review) throw new AppError("NOT_FOUND", "Review not found.");
  return review;
}

/** Reply in public to a published review; an empty reply removes it. */
export async function respondToReview(
  actor: Actor,
  restaurantId: string,
  reviewId: string,
  text: string,
): Promise<Review> {
  await authorizeRestaurant(actor.id, restaurantId, "review:respond");
  const response = responseSchema.parse(text);
  const review = await findReview(restaurantId, reviewId);
  if (review.status !== "published") {
    throw new AppError("CONFLICT", "Only published reviews can be answered.");
  }
  const updated = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(reviews)
      .set({
        response,
        respondedAt: response ? new Date() : null,
        respondedByUserId: response ? actor.id : null,
      })
      .where(eq(reviews.id, review.id))
      .returning();
    await recordAudit(tx, {
      actor,
      action: "review.responded",
      entityType: "review",
      entityId: review.id,
      restaurantId,
      metadata: { removed: response === null },
    });
    return updated!;
  });
  if (response && review.authorUserId) {
    const [restaurant] = await db
      .select({ name: restaurants.name })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId));
    await notify([review.authorUserId], {
      type: "review_replied",
      restaurantId,
      data: { restaurant: restaurant?.name ?? "" },
      link: "/reviews",
    });
  }
  return updated;
}

/** Ask the platform to look at a review; it stays visible until an admin decides. */
export async function reportReview(
  actor: Actor,
  restaurantId: string,
  reviewId: string,
  reason: string,
): Promise<Review> {
  await authorizeRestaurant(actor.id, restaurantId, "review:respond");
  const why = reportReasonSchema.parse(reason);
  const review = await findReview(restaurantId, reviewId);
  if (review.moderatedAt && review.status !== "published") {
    throw new AppError("CONFLICT", "This review has already been moderated.");
  }
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(reviews)
      .set({
        reportedAt: new Date(),
        reportedByUserId: actor.id,
        reportReason: why,
        moderatedAt: null,
      })
      .where(eq(reviews.id, review.id))
      .returning();
    await recordAudit(tx, {
      actor,
      action: "review.reported",
      entityType: "review",
      entityId: review.id,
      restaurantId,
      metadata: { reason: why },
    });
    return updated!;
  });
}
