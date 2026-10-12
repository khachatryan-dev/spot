"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import { createLocation } from "@/server/services/location-service";
import { createRestaurant, submitForReview } from "@/server/services/restaurant-service";
import type { CreateLocationInput } from "@/shared/schemas/location";
import type { CreateRestaurantInput } from "@/shared/schemas/restaurant";

// Arguments come from the browser: the services validate them and check access.

export async function createRestaurantAction(input: CreateRestaurantInput) {
  return action(async () => {
    const user = await requireUser();
    const restaurant = await createRestaurant(user, input);
    return { id: restaurant.id };
  });
}

export async function createLocationAction(restaurantId: string, input: CreateLocationInput) {
  return action(async () => {
    const user = await requireUser();
    const location = await createLocation(user, restaurantId, input);
    return { id: location.id };
  });
}

export async function submitForReviewAction(restaurantId: string) {
  return action(async () => {
    const user = await requireUser();
    await submitForReview(user, restaurantId);
    return { ok: true };
  });
}
