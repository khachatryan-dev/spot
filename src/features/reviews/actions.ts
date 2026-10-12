"use server";

import { getLocale } from "next-intl/server";

import { requireUser } from "@/server/auth/guards";
import { getCustomer } from "@/server/guests/current-customer";
import { action } from "@/server/http/response";
import { reportReview, respondToReview } from "@/server/services/restaurant-review-service";
import {
  createReview,
  deleteMyReview,
  type ReviewInput,
  updateMyReview,
} from "@/server/services/review-service";
import { AppError } from "@/shared/errors";

/** Review a completed visit or reservation of the current guest (§24). */
export async function createReviewAction(input: ReviewInput) {
  return action(async () => {
    const customer = await getCustomer();
    if (!customer) throw new AppError("NOT_FOUND", "Nothing to review here.");
    const review = await createReview(customer, { ...input, locale: await getLocale() });
    return { id: review.id };
  });
}

export async function updateMyReviewAction(
  reviewId: string,
  input: { rating: number; comment?: string | null },
) {
  return action(async () => {
    await updateMyReview(await requireUser(), reviewId, input);
    return { ok: true };
  });
}

export async function deleteMyReviewAction(reviewId: string) {
  return action(async () => {
    await deleteMyReview(await requireUser(), reviewId);
    return { ok: true };
  });
}

/** Restaurant replies in public (review:respond); empty text removes the reply. */
export async function respondToReviewAction(restaurantId: string, reviewId: string, text: string) {
  return action(async () => {
    await respondToReview(await requireUser(), restaurantId, reviewId, text);
    return { ok: true };
  });
}

/** Restaurant reports a review to the platform's moderators. */
export async function reportReviewAction(restaurantId: string, reviewId: string, reason: string) {
  return action(async () => {
    await reportReview(await requireUser(), restaurantId, reviewId, reason);
    return { ok: true };
  });
}
