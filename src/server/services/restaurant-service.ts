import "server-only";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import type { Restaurant } from "@/server/db/schema";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import * as repo from "@/server/repositories/restaurant-repository";
import { canTransition, isPubliclyVisible } from "@/shared/domain/restaurant-status";
import { AppError } from "@/shared/errors";
import {
  createRestaurantSchema,
  type CreateRestaurantInput,
  updateRestaurantSchema,
  type UpdateRestaurantInput,
} from "@/shared/schemas/restaurant";
import { slugify } from "@/shared/utils/slugify";

type Actor = Pick<SessionUser, "id">;

/** Unfinished restaurants a user may have at once (limits spam sign-ups). */
export const MAX_UNPUBLISHED_RESTAURANTS = 3;

/** Fields safe to show on public pages — no internal status details. */
export type PublicRestaurant = Pick<
  Restaurant,
  | "id"
  | "name"
  | "slug"
  | "description"
  | "cuisines"
  | "priceRange"
  | "currency"
  | "phone"
  | "email"
  | "website"
  | "logoKey"
  | "coverImageKey"
>;

/** Create a draft restaurant owned by the actor (§10). */
export async function createRestaurant(actor: Actor, input: CreateRestaurantInput) {
  const data = createRestaurantSchema.parse(input);

  const unpublished = await repo.countOwnedRestaurants(actor.id, ["draft", "pending_review"]);
  if (unpublished >= MAX_UNPUBLISHED_RESTAURANTS) {
    throw new AppError("CONFLICT", "Finish or close your other restaurants first.");
  }

  const base = slugify(data.name) || "restaurant";
  // Try base, base-2, base-3…; the unique index settles races between requests.
  for (let attempt = 1; attempt <= 20; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      return await db.transaction(async (tx) => {
        const restaurant = await repo.insertRestaurantWithOwner({ ...data, slug }, actor.id, tx);
        await recordAudit(tx, {
          actor,
          action: "restaurant.created",
          entityType: "restaurant",
          entityId: restaurant.id,
          restaurantId: restaurant.id,
        });
        return restaurant;
      });
    } catch (error) {
      if (!isUniqueViolation(error, "restaurants_slug_unique")) throw error;
    }
  }
  throw new AppError("CONFLICT", "Please choose a more distinctive name.");
}

export function listMyRestaurants(actor: Actor) {
  return repo.listRestaurantsForUser(actor.id);
}

/** Full restaurant record for its staff. */
export async function getRestaurant(actor: Actor, restaurantId: string): Promise<Restaurant> {
  await authorizeRestaurant(actor.id, restaurantId, "restaurant:read");
  const restaurant = await repo.findRestaurantById(restaurantId);
  if (!restaurant) throw new AppError("NOT_FOUND", "Restaurant not found.");
  return restaurant;
}

/** Edit the profile. Only fields in the schema can change — never status or slug. */
export async function updateRestaurant(
  actor: Actor,
  restaurantId: string,
  input: UpdateRestaurantInput,
): Promise<Restaurant> {
  const access = await authorizeRestaurant(actor.id, restaurantId, "restaurant:update");
  if (access.restaurantStatus === "closed") {
    throw new AppError("CONFLICT", "A closed restaurant can't be edited.");
  }
  const data = updateRestaurantSchema.parse(input);
  // Nothing editable in the request (e.g. only stripped fields): no-op.
  if (Object.keys(data).length === 0) {
    const current = await repo.findRestaurantById(restaurantId);
    if (!current) throw new AppError("NOT_FOUND", "Restaurant not found.");
    return current;
  }
  return db.transaction(async (tx) => {
    const updated = await repo.updateRestaurant(restaurantId, data, tx);
    if (!updated) throw new AppError("NOT_FOUND", "Restaurant not found.");
    await recordAudit(tx, {
      actor,
      action: "restaurant.updated",
      entityType: "restaurant",
      entityId: restaurantId,
      restaurantId,
      metadata: { fields: Object.keys(data) },
    });
    return updated;
  });
}

/** Owner submits a draft for platform approval; needs at least one active location. */
export async function submitForReview(actor: Actor, restaurantId: string): Promise<Restaurant> {
  const access = await authorizeRestaurant(actor.id, restaurantId, "restaurant:update");
  if (!canTransition(access.restaurantStatus, "pending_review", "owner")) {
    throw new AppError("CONFLICT", "Only draft restaurants can be submitted.");
  }
  if ((await repo.countActiveLocations(restaurantId)) === 0) {
    throw new AppError("VALIDATION_ERROR", "Add at least one location before submitting.");
  }

  return db.transaction(async (tx) => {
    const updated = await repo.transitionRestaurantStatus(
      restaurantId,
      "draft",
      "pending_review",
      { submittedAt: new Date(), statusReason: null },
      tx,
    );
    if (!updated) throw new AppError("CONFLICT", "The restaurant's status changed. Please reload.");
    await recordAudit(tx, {
      actor,
      action: "restaurant.submitted",
      entityType: "restaurant",
      entityId: restaurantId,
      restaurantId,
      metadata: { from: "draft", to: "pending_review" },
    });
    return updated;
  });
}

/** Public restaurant page data — ACTIVE restaurants only (§10). */
export async function getPublicRestaurant(slug: string): Promise<PublicRestaurant | null> {
  const restaurant = await repo.findRestaurantBySlug(slug);
  if (!restaurant || !isPubliclyVisible(restaurant.status)) return null;
  const {
    id,
    name,
    description,
    cuisines,
    priceRange,
    currency,
    phone,
    email,
    website,
    logoKey,
    coverImageKey,
  } = restaurant;
  return {
    id,
    name,
    slug: restaurant.slug,
    description,
    cuisines,
    priceRange,
    currency,
    phone,
    email,
    website,
    logoKey,
    coverImageKey,
  };
}
