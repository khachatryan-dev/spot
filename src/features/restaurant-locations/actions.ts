"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import { updateLocation } from "@/server/services/location-service";
import type { UpdateLocationInput } from "@/shared/schemas/location";

export async function updateLocationAction(
  restaurantId: string,
  locationId: string,
  input: UpdateLocationInput,
) {
  return action(async () => {
    const user = await requireUser();
    await updateLocation(user, restaurantId, locationId, input);
    return { ok: true };
  });
}
