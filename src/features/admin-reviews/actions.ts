"use server";

import { requirePlatformPermission } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import { moderateReview } from "@/server/services/admin-review-service";
import type { ModerationDecision } from "@/shared/domain/review-moderation";

export async function moderateReviewAction(
  reviewId: string,
  decision: ModerationDecision,
  reason?: string,
) {
  return action(async () => {
    const admin = await requirePlatformPermission("platform:reviews:moderate");
    const review = await moderateReview(admin, reviewId, { decision, reason });
    return { status: review.status };
  });
}
