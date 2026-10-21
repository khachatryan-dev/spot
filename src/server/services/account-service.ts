import "server-only";

import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import {
  favorites,
  orders,
  restaurantLocations,
  restaurants,
  tableSessionMembers,
  tableSessions,
  users,
} from "@/server/db/schema";
import { isPubliclyVisible } from "@/shared/domain/restaurant-status";
import { AppError } from "@/shared/errors";
import { type ProfileInput, profileSchema } from "@/shared/schemas/account";

/*
 * A signed-in guest's own account (§25): profile, saved restaurants and
 * their visit history. Everything here is scoped to the caller.
 */

type Actor = Pick<SessionUser, "id">;

export async function getProfile(actor: Actor) {
  const [user] = await db
    .select({
      name: users.name,
      email: users.email,
      phone: users.phone,
      preferredLocale: users.preferredLocale,
    })
    .from(users)
    .where(eq(users.id, actor.id));
  if (!user) throw new AppError("NOT_FOUND", "Account not found.");
  return user;
}

export async function updateProfile(actor: Actor, input: ProfileInput) {
  const data = profileSchema.parse(input);
  try {
    await db.update(users).set(data).where(eq(users.id, actor.id));
  } catch (error) {
    if (isUniqueViolation(error, "users_phone_unique")) {
      throw new AppError("CONFLICT", "This phone number belongs to another account.", {
        fieldErrors: { phone: ["phoneTaken"] },
      });
    }
    throw error;
  }
}

/** Save or unsave a restaurant. Only public restaurants can be saved. */
export async function setFavorite(actor: Actor, restaurantId: string, saved: boolean) {
  if (!z.uuid().safeParse(restaurantId).success) {
    throw new AppError("NOT_FOUND", "Restaurant not found.");
  }
  if (!saved) {
    await db
      .delete(favorites)
      .where(and(eq(favorites.userId, actor.id), eq(favorites.restaurantId, restaurantId)));
    return;
  }
  const [restaurant] = await db
    .select({ status: restaurants.status })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId));
  if (!restaurant || !isPubliclyVisible(restaurant.status)) {
    throw new AppError("NOT_FOUND", "Restaurant not found.");
  }
  await db.insert(favorites).values({ userId: actor.id, restaurantId }).onConflictDoNothing();
}

export async function isFavorite(actor: Actor, restaurantId: string): Promise<boolean> {
  const [row] = await db
    .select({ restaurantId: favorites.restaurantId })
    .from(favorites)
    .where(and(eq(favorites.userId, actor.id), eq(favorites.restaurantId, restaurantId)));
  return !!row;
}

export interface FavoriteRestaurant {
  restaurantId: string;
  name: string;
  slug: string;
  /** A location that takes reservations, for "Book again". */
  bookingLocationSlug: string | null;
}

/** Saved restaurants that are still public, latest saved first. */
export async function listFavorites(actor: Actor): Promise<FavoriteRestaurant[]> {
  const saved = await db
    .select({ restaurantId: restaurants.id, name: restaurants.name, slug: restaurants.slug })
    .from(favorites)
    .innerJoin(restaurants, eq(restaurants.id, favorites.restaurantId))
    .where(and(eq(favorites.userId, actor.id), eq(restaurants.status, "active")))
    .orderBy(desc(favorites.createdAt));
  return withBookingLocations(saved);
}

async function withBookingLocations<T extends { restaurantId: string }>(rows: T[]) {
  if (rows.length === 0) return [];
  const locations = await db
    .select({ restaurantId: restaurantLocations.restaurantId, slug: restaurantLocations.slug })
    .from(restaurantLocations)
    .where(
      and(
        inArray(
          restaurantLocations.restaurantId,
          rows.map((r) => r.restaurantId),
        ),
        eq(restaurantLocations.status, "active"),
        eq(restaurantLocations.reservationsEnabled, true),
      ),
    )
    .orderBy(asc(restaurantLocations.sortOrder));
  return rows.map((r) => ({
    ...r,
    bookingLocationSlug: locations.find((l) => l.restaurantId === r.restaurantId)?.slug ?? null,
  }));
}

export interface PastVisit {
  sessionId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  restaurantPublic: boolean;
  locationName: string;
  visitedAt: Date;
  orderCount: number;
  /** What this guest ordered (not the whole table), in the restaurant's currency. */
  spentMinor: number;
  currency: string;
  bookingLocationSlug: string | null;
}

export interface VisitSummary {
  /** Table visits where this guest ordered something. */
  visits: number;
  /** What they ordered over all visits, per currency (most restaurants use AMD). */
  spent: { currency: string; minor: number }[];
}

/** Totals for the customer app's home: visits and spending, cancelled orders excluded. */
export async function getVisitSummary(actor: Actor): Promise<VisitSummary> {
  const rows = await db
    .select({
      currency: restaurants.currency,
      visits: sql<number>`count(distinct ${tableSessions.id})::int`,
      minor: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::int`,
    })
    .from(tableSessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, tableSessionMembers.sessionId))
    .innerJoin(restaurants, eq(restaurants.id, tableSessions.restaurantId))
    .innerJoin(orders, eq(orders.memberId, tableSessionMembers.id))
    .where(
      and(
        eq(tableSessionMembers.userId, actor.id),
        notInArray(orders.status, ["cancelled", "rejected"]),
      ),
    )
    .groupBy(restaurants.currency)
    .orderBy(desc(sql`sum(${orders.totalMinor})`));
  return {
    visits: rows.reduce((total, row) => total + row.visits, 0),
    spent: rows.map(({ currency, minor }) => ({ currency, minor })),
  };
}

/** Table visits where this guest ordered, latest first. */
export async function listMyVisits(actor: Actor, limit = 50): Promise<PastVisit[]> {
  const rows = await db
    .select({
      sessionId: tableSessions.id,
      restaurantId: restaurants.id,
      restaurantName: restaurants.name,
      restaurantSlug: restaurants.slug,
      restaurantStatus: restaurants.status,
      locationName: restaurantLocations.name,
      visitedAt: tableSessions.createdAt,
      orderCount: sql<number>`count(${orders.id})::int`,
      spentMinor: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::int`,
      currency: restaurants.currency,
    })
    .from(tableSessionMembers)
    .innerJoin(tableSessions, eq(tableSessions.id, tableSessionMembers.sessionId))
    .innerJoin(restaurants, eq(restaurants.id, tableSessions.restaurantId))
    .innerJoin(orders, eq(orders.memberId, tableSessionMembers.id))
    .innerJoin(restaurantLocations, eq(restaurantLocations.id, orders.locationId))
    .where(
      and(
        eq(tableSessionMembers.userId, actor.id),
        notInArray(orders.status, ["cancelled", "rejected"]),
      ),
    )
    .groupBy(tableSessions.id, restaurants.id, restaurantLocations.id)
    .orderBy(desc(tableSessions.createdAt))
    .limit(limit);
  const withLinks = await withBookingLocations(rows);
  return withLinks.map(({ restaurantStatus, ...visit }) => ({
    ...visit,
    restaurantPublic: isPubliclyVisible(restaurantStatus),
  }));
}
