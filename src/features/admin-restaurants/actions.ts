"use server";

import { requirePlatformPermission } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import {
  approveRestaurant,
  reinstateRestaurant,
  rejectRestaurant,
  suspendRestaurant,
} from "@/server/services/admin-restaurant-service";
import type { StatusReasonInput } from "@/shared/schemas/admin";

// The service re-checks platform permissions; this only gets the signed-in admin.
const admin = () => requirePlatformPermission("platform:restaurants:manage");

export async function approveRestaurantAction(restaurantId: string) {
  return action(async () => {
    await approveRestaurant(await admin(), restaurantId);
    return { ok: true };
  });
}

export async function rejectRestaurantAction(restaurantId: string, input: StatusReasonInput) {
  return action(async () => {
    await rejectRestaurant(await admin(), restaurantId, input);
    return { ok: true };
  });
}

export async function suspendRestaurantAction(restaurantId: string, input: StatusReasonInput) {
  return action(async () => {
    await suspendRestaurant(await admin(), restaurantId, input);
    return { ok: true };
  });
}

export async function reinstateRestaurantAction(restaurantId: string) {
  return action(async () => {
    await reinstateRestaurant(await admin(), restaurantId);
    return { ok: true };
  });
}
