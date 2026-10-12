"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import {
  ensureLocationQr,
  ensureTableQr,
  revokeTableQr,
  rotateTableQr,
} from "@/server/services/qr-service";

export async function ensureLocationQrAction(restaurantId: string, locationId: string) {
  return action(async () => ({
    created: await ensureLocationQr(await requireUser(), restaurantId, locationId),
  }));
}

export async function ensureTableQrAction(restaurantId: string, tableId: string) {
  return action(async () => {
    await ensureTableQr(await requireUser(), restaurantId, tableId);
    return { ok: true };
  });
}

export async function rotateTableQrAction(restaurantId: string, tableId: string) {
  return action(async () => {
    await rotateTableQr(await requireUser(), restaurantId, tableId);
    return { ok: true };
  });
}

export async function revokeTableQrAction(restaurantId: string, tableId: string) {
  return action(async () => {
    await revokeTableQr(await requireUser(), restaurantId, tableId);
    return { ok: true };
  });
}
