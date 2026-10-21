"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import {
  type CustomerReviewInput,
  type CustomerReviewTarget,
  rateCustomer,
} from "@/server/services/customer-review-service";

/** A restaurant rates a customer after their visit (customer:rate). */
export async function rateCustomerAction(
  restaurantId: string,
  target: CustomerReviewTarget,
  input: CustomerReviewInput,
) {
  return action(async () => {
    const review = await rateCustomer(await requireUser(), restaurantId, target, input);
    return { rating: review.rating };
  });
}
