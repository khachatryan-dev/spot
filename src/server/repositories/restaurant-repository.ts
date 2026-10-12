import "server-only";

import { and, count, eq, inArray } from "drizzle-orm";

import { db, type Executor } from "@/server/db/client";
import {
  type Restaurant,
  restaurantLocations,
  restaurants,
  restaurantStaff,
} from "@/server/db/schema";
import type { RestaurantStatus } from "@/shared/constants/restaurants";
import type { RestaurantRole } from "@/shared/constants/roles";

/*
 * Data access for restaurants. Every function takes the restaurant or user it
 * is scoped to; authorization happens in restaurant-service.ts.
 */

type RestaurantValues = Omit<typeof restaurants.$inferInsert, "id" | "createdAt" | "updatedAt">;

/** Create a restaurant and make `ownerId` its owner. Run inside a transaction. */
export async function insertRestaurantWithOwner(
  values: RestaurantValues,
  ownerId: string,
  executor: Executor = db,
) {
  const [restaurant] = await executor.insert(restaurants).values(values).returning();
  if (!restaurant) throw new Error("Failed to insert restaurant");
  await executor
    .insert(restaurantStaff)
    .values({ restaurantId: restaurant.id, userId: ownerId, role: "owner" });
  return restaurant;
}

export async function findRestaurantById(
  restaurantId: string,
  executor: Executor = db,
): Promise<Restaurant | null> {
  const [row] = await executor.select().from(restaurants).where(eq(restaurants.id, restaurantId));
  return row ?? null;
}

export async function findRestaurantBySlug(slug: string): Promise<Restaurant | null> {
  const [row] = await db.select().from(restaurants).where(eq(restaurants.slug, slug));
  return row ?? null;
}

export async function updateRestaurant(
  restaurantId: string,
  values: Partial<RestaurantValues>,
  executor: Executor = db,
): Promise<Restaurant | null> {
  const [row] = await executor
    .update(restaurants)
    .set(values)
    .where(eq(restaurants.id, restaurantId))
    .returning();
  return row ?? null;
}

/**
 * Change status only if it is still `from` — concurrent changes can't both
 * win. Returns null if the status had already changed.
 */
export async function transitionRestaurantStatus(
  restaurantId: string,
  from: RestaurantStatus,
  to: RestaurantStatus,
  extra: Partial<RestaurantValues> = {},
  executor: Executor = db,
): Promise<Restaurant | null> {
  const [row] = await executor
    .update(restaurants)
    .set({ ...extra, status: to })
    .where(and(eq(restaurants.id, restaurantId), eq(restaurants.status, from)))
    .returning();
  return row ?? null;
}

export interface UserRestaurant {
  restaurant: Pick<Restaurant, "id" | "name" | "slug" | "status">;
  role: RestaurantRole;
}

/** Restaurants where the user is active staff, with their role. */
export async function listRestaurantsForUser(userId: string): Promise<UserRestaurant[]> {
  return db
    .select({
      restaurant: {
        id: restaurants.id,
        name: restaurants.name,
        slug: restaurants.slug,
        status: restaurants.status,
      },
      role: restaurantStaff.role,
    })
    .from(restaurantStaff)
    .innerJoin(restaurants, eq(restaurants.id, restaurantStaff.restaurantId))
    .where(and(eq(restaurantStaff.userId, userId), eq(restaurantStaff.status, "active")))
    .orderBy(restaurants.name);
}

export async function countOwnedRestaurants(userId: string, statuses: RestaurantStatus[]) {
  const [row] = await db
    .select({ value: count() })
    .from(restaurantStaff)
    .innerJoin(restaurants, eq(restaurants.id, restaurantStaff.restaurantId))
    .where(
      and(
        eq(restaurantStaff.userId, userId),
        eq(restaurantStaff.role, "owner"),
        inArray(restaurants.status, statuses),
      ),
    );
  return row?.value ?? 0;
}

export async function countActiveLocations(restaurantId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(restaurantLocations)
    .where(
      and(
        eq(restaurantLocations.restaurantId, restaurantId),
        eq(restaurantLocations.status, "active"),
      ),
    );
  return row?.value ?? 0;
}
