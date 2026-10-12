import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { z } from "zod";

import { db } from "@/server/db/client";
import { paymentsAvailable } from "@/server/payments/registry";
import { isUniqueViolation } from "@/server/db/errors";
import { type RestaurantLocation, restaurantLocations } from "@/server/db/schema";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { AppError } from "@/shared/errors";
import {
  createLocationSchema,
  type CreateLocationInput,
  updateLocationSchema,
  type UpdateLocationInput,
} from "@/shared/schemas/location";
import { slugify } from "@/shared/utils/slugify";

type Actor = Pick<SessionUser, "id">;

/** Locations of a restaurant, for its staff. */
export async function listLocations(
  actor: Actor,
  restaurantId: string,
): Promise<RestaurantLocation[]> {
  await authorizeRestaurant(actor.id, restaurantId, "restaurant:read");
  return db
    .select()
    .from(restaurantLocations)
    .where(eq(restaurantLocations.restaurantId, restaurantId))
    .orderBy(asc(restaurantLocations.sortOrder), asc(restaurantLocations.createdAt));
}

/** Add a location (owner only). The slug is derived from the name, unique within the restaurant. */
export async function createLocation(
  actor: Actor,
  restaurantId: string,
  input: CreateLocationInput,
): Promise<RestaurantLocation> {
  const access = await authorizeRestaurant(actor.id, restaurantId, "location:manage");
  if (access.restaurantStatus === "closed") {
    throw new AppError("CONFLICT", "A closed restaurant can't be edited.");
  }
  const data = createLocationSchema.parse(input);

  const base = slugify(data.name) || "location";
  for (let attempt = 1; attempt <= 20; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      return await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(restaurantLocations)
          .values({ ...data, restaurantId, slug })
          .returning();
        if (!created) throw new Error("Failed to insert location");
        await recordAudit(tx, {
          actor,
          action: "location.created",
          entityType: "location",
          entityId: created.id,
          restaurantId,
        });
        return created;
      });
    } catch (error) {
      if (!isUniqueViolation(error, "restaurant_locations_restaurant_slug_unique")) throw error;
    }
  }
  throw new AppError("CONFLICT", "Please choose a more distinctive location name.");
}

/** Location scoped to its restaurant: an id from another restaurant is NOT_FOUND. */
async function findScopedLocation(restaurantId: string, locationId: string) {
  if (!z.uuid().safeParse(locationId).success) return null;
  const [location] = await db
    .select()
    .from(restaurantLocations)
    .where(
      and(
        eq(restaurantLocations.id, locationId),
        eq(restaurantLocations.restaurantId, restaurantId),
      ),
    );
  return location ?? null;
}

export async function getLocation(
  actor: Actor,
  restaurantId: string,
  locationId: string,
): Promise<RestaurantLocation> {
  await authorizeRestaurant(actor.id, restaurantId, "restaurant:read");
  const location = await findScopedLocation(restaurantId, locationId);
  if (!location) throw new AppError("NOT_FOUND", "Location not found.");
  return location;
}

/**
 * Update a location (owner only). Locations are deactivated, never deleted —
 * tables, orders and reservations will reference them.
 */
export async function updateLocation(
  actor: Actor,
  restaurantId: string,
  locationId: string,
  input: UpdateLocationInput,
): Promise<RestaurantLocation> {
  const access = await authorizeRestaurant(actor.id, restaurantId, "location:manage");
  if (access.restaurantStatus === "closed") {
    throw new AppError("CONFLICT", "A closed restaurant can't be edited.");
  }
  const location = await findScopedLocation(restaurantId, locationId);
  if (!location) throw new AppError("NOT_FOUND", "Location not found.");

  const data = updateLocationSchema.parse(input);
  if (Object.keys(data).length === 0) return location;
  if (
    data.reservationDepositType &&
    data.reservationDepositType !== "none" &&
    !paymentsAvailable()
  ) {
    throw new AppError("VALIDATION_ERROR", "Online payments aren't available yet.", {
      fieldErrors: { reservationDepositType: ["paymentsUnavailable"] },
    });
  }

  // A submitted or live restaurant must keep at least one active location.
  const deactivating = data.status === "inactive" && location.status === "active";
  if (deactivating && access.restaurantStatus !== "draft") {
    const [other] = await db
      .select({ id: restaurantLocations.id })
      .from(restaurantLocations)
      .where(
        and(
          eq(restaurantLocations.restaurantId, restaurantId),
          eq(restaurantLocations.status, "active"),
          ne(restaurantLocations.id, locationId),
        ),
      )
      .limit(1);
    if (!other) {
      throw new AppError("CONFLICT", "A restaurant needs at least one active location.");
    }
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(restaurantLocations)
      .set(data)
      .where(
        and(
          eq(restaurantLocations.id, locationId),
          eq(restaurantLocations.restaurantId, restaurantId),
        ),
      )
      .returning();
    if (!updated) throw new AppError("NOT_FOUND", "Location not found.");
    const statusChange =
      data.status && data.status !== location.status
        ? { from: location.status, to: data.status }
        : {};
    await recordAudit(tx, {
      actor,
      action: "location.updated",
      entityType: "location",
      entityId: locationId,
      restaurantId,
      metadata: { fields: Object.keys(data), ...statusChange },
    });
    return updated;
  });
}
