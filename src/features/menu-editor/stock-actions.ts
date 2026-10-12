"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import { setItemAvailability, setModifierAvailability } from "@/server/services/menu-service";

export async function setItemStockAction(
  restaurantId: string,
  itemId: string,
  isAvailable: boolean,
) {
  return action(async () => {
    await setItemAvailability(await requireUser(), restaurantId, itemId, isAvailable);
    return { ok: true };
  });
}

export async function setModifierStockAction(
  restaurantId: string,
  modifierId: string,
  isAvailable: boolean,
) {
  return action(async () => {
    await setModifierAvailability(await requireUser(), restaurantId, modifierId, isAvailable);
    return { ok: true };
  });
}
