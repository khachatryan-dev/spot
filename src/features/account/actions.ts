"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import { setFavorite, updateProfile } from "@/server/services/account-service";
import type { ProfileInput } from "@/shared/schemas/account";

export async function updateProfileAction(input: ProfileInput) {
  return action(async () => {
    await updateProfile(await requireUser(), input);
    return { ok: true };
  });
}

export async function setFavoriteAction(restaurantId: string, saved: boolean) {
  return action(async () => {
    await setFavorite(await requireUser(), restaurantId, saved);
    return { saved };
  });
}
