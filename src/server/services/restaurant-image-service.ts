import "server-only";

import { randomUUID } from "node:crypto";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { IMAGE_PRESETS, processImage } from "@/server/images/process-image";
import { logger } from "@/server/logger";
import { hitRateLimit } from "@/server/rate-limit/rate-limit";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { getItem, setItemImageKey } from "@/server/services/menu-service";
import * as repo from "@/server/repositories/restaurant-repository";
import { getStorage } from "@/server/storage/storage";
import { AppError } from "@/shared/errors";

type Actor = Pick<SessionUser, "id">;

export const RESTAURANT_IMAGE_KINDS = ["logo", "cover"] as const;
export type RestaurantImageKind = (typeof RESTAURANT_IMAGE_KINDS)[number];

const COLUMN = { logo: "logoKey", cover: "coverImageKey" } as const;
const log = logger.child({ module: "restaurant-images" });

function requireStorage() {
  const storage = getStorage();
  if (!storage) throw new AppError("RESOURCE_UNAVAILABLE", "Image uploads aren't configured.");
  return storage;
}

/** Image processing is the heaviest thing staff can trigger: cap it per person. */
export const UPLOAD_LIMIT = { max: 30, windowMs: 10 * 60_000 };

async function checkUploadLimit(actor: Actor) {
  if (!(await hitRateLimit(`upload:${actor.id}`, UPLOAD_LIMIT)).allowed) {
    throw new AppError("RATE_LIMITED", "Too many uploads. Please wait a few minutes.");
  }
}

async function authorize(actor: Actor, restaurantId: string) {
  const access = await authorizeRestaurant(actor.id, restaurantId, "restaurant:update");
  if (access.restaurantStatus === "closed") {
    throw new AppError("CONFLICT", "A closed restaurant can't be edited.");
  }
}

/** Delete an old object; failure only leaves an orphan file, so it's logged, not thrown. */
async function deleteQuietly(key: string | null) {
  if (!key) return;
  try {
    await requireStorage().delete(key);
  } catch (err) {
    log.warn("Failed to delete old image", { key, err });
  }
}

/** Validate, re-encode and store a logo or cover image; replaces the previous one. */
export async function uploadRestaurantImage(
  actor: Actor,
  restaurantId: string,
  kind: RestaurantImageKind,
  bytes: Uint8Array,
): Promise<{ key: string }> {
  await authorize(actor, restaurantId);
  await checkUploadLimit(actor);
  const storage = requireStorage();
  const image = await processImage(bytes, IMAGE_PRESETS[kind]);

  // Random key: unguessable, and a new URL per upload so CDN caches never go stale.
  const key = `restaurants/${restaurantId}/${kind}/${randomUUID()}.webp`;
  await storage.put(key, image.data, {
    contentType: "image/webp",
    cacheControl: "public, max-age=31536000, immutable",
  });

  const previous = await repo.findRestaurantById(restaurantId);
  try {
    await db.transaction(async (tx) => {
      const updated = await repo.updateRestaurant(restaurantId, { [COLUMN[kind]]: key }, tx);
      if (!updated) throw new AppError("NOT_FOUND", "Restaurant not found.");
      await recordAudit(tx, {
        actor,
        action: "restaurant.image_updated",
        entityType: "restaurant",
        entityId: restaurantId,
        restaurantId,
        metadata: { kind, change: "uploaded" },
      });
    });
  } catch (error) {
    await deleteQuietly(key); // don't leave an orphaned upload behind
    throw error;
  }
  await deleteQuietly(previous?.[COLUMN[kind]] ?? null);
  return { key };
}

export async function removeRestaurantImage(
  actor: Actor,
  restaurantId: string,
  kind: RestaurantImageKind,
): Promise<void> {
  await authorize(actor, restaurantId);
  const previous = await repo.findRestaurantById(restaurantId);
  const key = previous?.[COLUMN[kind]];
  if (!key) return;
  await db.transaction(async (tx) => {
    await repo.updateRestaurant(restaurantId, { [COLUMN[kind]]: null }, tx);
    await recordAudit(tx, {
      actor,
      action: "restaurant.image_updated",
      entityType: "restaurant",
      entityId: restaurantId,
      restaurantId,
      metadata: { kind, change: "removed" },
    });
  });
  await deleteQuietly(key);
}

/** Validate, re-encode and store a menu item photo; replaces the previous one. */
export async function uploadMenuItemImage(
  actor: Actor,
  restaurantId: string,
  itemId: string,
  bytes: Uint8Array,
): Promise<{ key: string }> {
  // Checks menu:manage and that the item belongs to this restaurant, before any work.
  await getItem(actor, restaurantId, itemId);
  await authorizeRestaurant(actor.id, restaurantId, "menu:manage");
  await checkUploadLimit(actor);
  const storage = requireStorage();
  const image = await processImage(bytes, IMAGE_PRESETS.menuItem);

  const key = `restaurants/${restaurantId}/menu/${itemId}/${randomUUID()}.webp`;
  await storage.put(key, image.data, {
    contentType: "image/webp",
    cacheControl: "public, max-age=31536000, immutable",
  });
  try {
    const { previous } = await setItemImageKey(actor, restaurantId, itemId, key);
    await deleteQuietly(previous);
  } catch (error) {
    await deleteQuietly(key);
    throw error;
  }
  return { key };
}

export async function removeMenuItemImage(actor: Actor, restaurantId: string, itemId: string) {
  const { previous } = await setItemImageKey(actor, restaurantId, itemId, null);
  await deleteQuietly(previous);
}
