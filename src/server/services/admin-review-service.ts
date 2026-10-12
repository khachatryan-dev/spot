import "server-only";

import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { type Review, restaurants, reviews } from "@/server/db/schema";
import { authorizePlatform } from "@/server/policies/restaurant-access";
import type { AuditAction } from "@/shared/constants/audit";
import {
  MODERATION_DECISIONS,
  type ModerationDecision,
  moderationRule,
} from "@/shared/domain/review-moderation";
import { AppError } from "@/shared/errors";

/*
 * Review moderation for platform admins (platform:reviews:moderate):
 * reported reviews first, then everything recent; keep, hide, reject or
 * restore, each recorded in the audit log.
 */

type Admin = Pick<SessionUser, "id" | "platformRole">;

export interface ModerationItem {
  id: string;
  restaurantId: string;
  restaurantName: string;
  displayName: string;
  authorEmail: string | null;
  authorEmailVerified: boolean;
  rating: number;
  comment: string | null;
  status: Review["status"];
  createdAt: Date;
  reportedAt: Date | null;
  reportReason: string | null;
  moderatedAt: Date | null;
  moderationReason: string | null;
  response: string | null;
}

const columns = {
  id: reviews.id,
  restaurantId: reviews.restaurantId,
  restaurantName: restaurants.name,
  displayName: reviews.displayName,
  authorEmail: reviews.authorEmail,
  authorEmailVerified: sql<boolean>`${reviews.authorEmailVerifiedAt} IS NOT NULL`,
  rating: reviews.rating,
  comment: reviews.comment,
  status: reviews.status,
  createdAt: reviews.createdAt,
  reportedAt: reviews.reportedAt,
  reportReason: reviews.reportReason,
  moderatedAt: reviews.moderatedAt,
  moderationReason: reviews.moderationReason,
  response: reviews.response,
};

/** Reported reviews awaiting a decision (oldest report first), and recent reviews. */
export async function listReviewsForModeration(
  admin: Admin,
  options: { search?: string } = {},
): Promise<{ reported: ModerationItem[]; recent: ModerationItem[] }> {
  authorizePlatform(admin, "platform:reviews:moderate");
  const search = options.search?.trim().slice(0, 100);
  const matches = search
    ? or(
        ilike(restaurants.name, `%${search}%`),
        ilike(reviews.comment, `%${search}%`),
        ilike(reviews.displayName, `%${search}%`),
      )
    : undefined;
  const [reported, recent] = await Promise.all([
    db
      .select(columns)
      .from(reviews)
      .innerJoin(restaurants, eq(restaurants.id, reviews.restaurantId))
      .where(and(isNotNull(reviews.reportedAt), isNull(reviews.moderatedAt), matches))
      .orderBy(asc(reviews.reportedAt)),
    db
      .select(columns)
      .from(reviews)
      .innerJoin(restaurants, eq(restaurants.id, reviews.restaurantId))
      .where(matches)
      .orderBy(desc(reviews.createdAt))
      .limit(100),
  ]);
  return { reported, recent };
}

const decisionSchema = z.object({
  decision: z.enum(MODERATION_DECISIONS),
  reason: z
    .string()
    .trim()
    .max(500, "reasonTooLong")
    .transform((v) => (v === "" ? null : v))
    .nullish(),
});

const AUDIT: Record<ModerationDecision, AuditAction> = {
  keep: "review.kept",
  hide: "review.hidden",
  reject: "review.rejected",
  restore: "review.restored",
};

/** Keep, hide, reject or restore a review (with a reason when it comes down). */
export async function moderateReview(
  admin: Admin,
  reviewId: string,
  input: { decision: ModerationDecision; reason?: string | null },
): Promise<Review> {
  authorizePlatform(admin, "platform:reviews:moderate");
  const { decision, reason } = decisionSchema.parse(input);
  const rule = moderationRule(decision);
  if (rule.reasonRequired && (!reason || reason.length < 5)) {
    throw new AppError("VALIDATION_ERROR", "Give a reason.", {
      fieldErrors: { reason: ["reasonTooShort"] },
    });
  }
  if (!z.uuid().safeParse(reviewId).success) throw new AppError("NOT_FOUND", "Review not found.");

  return db.transaction(async (tx) => {
    const [review] = await tx.select().from(reviews).where(eq(reviews.id, reviewId)).for("update");
    if (!review) throw new AppError("NOT_FOUND", "Review not found.");
    if (!rule.from.includes(review.status)) {
      throw new AppError("CONFLICT", "That decision doesn't apply to this review now.");
    }
    const now = new Date();
    const [updated] = await tx
      .update(reviews)
      .set({
        status: rule.to,
        moderatedAt: now,
        moderatedByUserId: admin.id,
        moderationReason: reason ?? null,
        ...(rule.to === "published" && !review.publishedAt && { publishedAt: now }),
      })
      .where(eq(reviews.id, review.id))
      .returning();
    await recordAudit(tx, {
      actor: admin,
      action: AUDIT[decision],
      entityType: "review",
      entityId: review.id,
      restaurantId: review.restaurantId,
      metadata: { from: review.status, to: rule.to, ...(reason && { reason }) },
    });
    return updated!;
  });
}

/** How many reports wait for a decision (admin navigation badge). */
export async function countOpenReports(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reviews)
    .where(and(isNotNull(reviews.reportedAt), isNull(reviews.moderatedAt)));
  return row!.count;
}
