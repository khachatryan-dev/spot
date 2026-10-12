"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import { updateRestaurant } from "@/server/services/restaurant-service";
import type { UpdateRestaurantInput } from "@/shared/schemas/restaurant";

export async function updateRestaurantProfileAction(
  restaurantId: string,
  input: UpdateRestaurantInput,
) {
  return action(async () => {
    const user = await requireUser();
    await updateRestaurant(user, restaurantId, input);
    return { ok: true };
  });
}
