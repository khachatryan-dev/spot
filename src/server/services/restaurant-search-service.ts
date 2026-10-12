import "server-only";

import { and, eq, exists, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/server/db/client";
import { restaurantLocations, restaurants } from "@/server/db/schema";
import { CUISINES, type Cuisine } from "@/shared/constants/cuisines";
import { isOpenAt } from "@/shared/domain/availability";
import { distanceKm, parseLatLng } from "@/shared/domain/geo";
import { imageUrl } from "@/shared/utils/image-url";

/*
 * Restaurant discovery (§26): approved restaurants only. Text matches the
 * name with typos tolerated (pg_trgm), the description, and cuisines by
 * their translated names. "Open now" is checked per location in its own
 * time zone. Up to MAX_CANDIDATES are ranked; the page shows the first
 * `limit` of them.
 */

const MAX_CANDIDATES = 500;
export const PAGE_SIZE = 12;
export const SORTS = ["rating", "reviews", "newest", "distance"] as const;

/** A ticked checkbox in the URL ("1" / "true"); anything else is off. */
const checkbox = z.preprocess((v) => v === "1" || v === "true" || v === true, z.boolean());

export const searchQuerySchema = z.object({
  q: z.string().trim().max(100).catch(""),
  cuisine: z.enum(CUISINES).optional().catch(undefined),
  price: z.coerce.number().int().min(1).max(4).optional().catch(undefined),
  city: z.string().trim().max(100).optional().catch(undefined),
  reservable: checkbox,
  openNow: checkbox,
  sort: z.enum(SORTS).catch("rating"),
  /** "lat,lng" from "Near me": the guest's position, only ever in the URL. */
  near: z.unknown().optional().transform(parseLatLng),
  limit: z.coerce.number().int().min(PAGE_SIZE).max(120).catch(PAGE_SIZE),
});

export type SearchQuery = z.output<typeof searchQuerySchema>;

export interface SearchResult {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  cuisines: Cuisine[];
  priceRange: number | null;
  coverUrl: string | null;
  rating: number | null;
  reviewCount: number;
  cities: string[];
  /** The first location that takes reservations, for "Reserve". */
  bookingLocationSlug: string | null;
  openNow: boolean;
  /** Pins for the map: locations with coordinates. */
  pins: { name: string; lat: number; lng: number }[];
  /** To the nearest location, when the guest shared their position. */
  distanceKm: number | null;
}

/**
 * Find restaurants. `cuisineNames` maps each cuisine to its names in every
 * UI language, so "Հայկական" and "Armenian" both find armenian restaurants.
 */
export async function searchRestaurants(
  query: SearchQuery,
  cuisineNames: Record<Cuisine, string[]>,
  now = new Date(),
): Promise<{ results: SearchResult[]; total: number }> {
  const conditions: SQL[] = [eq(restaurants.status, "active")];
  const q = query.q.toLowerCase();
  if (q) {
    const cuisinesNamed = CUISINES.filter(
      (c) =>
        q.length >= 2 &&
        cuisineNames[c].some(
          (name) => name.toLowerCase().includes(q) || q.includes(name.toLowerCase()),
        ),
    );
    conditions.push(
      or(
        ilike(restaurants.name, `%${escapeLike(q)}%`),
        sql`word_similarity(${q}, lower(${restaurants.name})) > 0.4`,
        ilike(restaurants.description, `%${escapeLike(q)}%`),
        ...(cuisinesNamed.length > 0
          ? [sql`${restaurants.cuisines} && ${sql.param(cuisinesNamed)}::text[]`]
          : []),
      )!,
    );
  }
  if (query.cuisine) conditions.push(sql`${query.cuisine} = ANY(${restaurants.cuisines})`);
  if (query.price) conditions.push(eq(restaurants.priceRange, query.price));
  const locationsWhere = (extra?: SQL) =>
    exists(
      db
        .select({ id: restaurantLocations.id })
        .from(restaurantLocations)
        .where(
          and(
            eq(restaurantLocations.restaurantId, restaurants.id),
            eq(restaurantLocations.status, "active"),
            extra,
          ),
        ),
    );
  conditions.push(locationsWhere());
  if (query.city) {
    conditions.push(locationsWhere(sql`lower(${restaurantLocations.city}) = lower(${query.city})`));
  }
  if (query.reservable) {
    conditions.push(locationsWhere(eq(restaurantLocations.reservationsEnabled, true)));
  }

  // Written out with aliases: inside a select list Drizzle leaves column
  // names unqualified, which would compare reviews with themselves.
  const rating = sql<number | null>`(SELECT round(avg(rv.rating), 1)::float FROM reviews rv
    WHERE rv.restaurant_id = "restaurants"."id" AND rv.status = 'published')`;
  const reviewCount = sql<number>`(SELECT count(*)::int FROM reviews rv
    WHERE rv.restaurant_id = "restaurants"."id" AND rv.status = 'published')`;
  // With a search term, the closest name match comes first.
  const relevance = q ? [sql`word_similarity(${q}, lower(${restaurants.name})) DESC`] : [];
  const order =
    query.sort === "newest"
      ? [sql`${restaurants.approvedAt} DESC NULLS LAST`]
      : query.sort === "reviews"
        ? [sql`${reviewCount} DESC`, sql`${rating} DESC NULLS LAST`]
        : [...relevance, sql`${rating} DESC NULLS LAST`, sql`${reviewCount} DESC`];

  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      description: restaurants.description,
      cuisines: restaurants.cuisines,
      priceRange: restaurants.priceRange,
      coverImageKey: restaurants.coverImageKey,
      rating,
      reviewCount,
    })
    .from(restaurants)
    .where(and(...conditions))
    .orderBy(...order, restaurants.name)
    .limit(MAX_CANDIDATES);
  if (rows.length === 0) return { results: [], total: 0 };

  const locations = await db
    .select({
      restaurantId: restaurantLocations.restaurantId,
      slug: restaurantLocations.slug,
      city: restaurantLocations.city,
      timezone: restaurantLocations.timezone,
      openingHours: restaurantLocations.openingHours,
      reservationsEnabled: restaurantLocations.reservationsEnabled,
      name: restaurantLocations.name,
      latitude: restaurantLocations.latitude,
      longitude: restaurantLocations.longitude,
    })
    .from(restaurantLocations)
    .where(
      and(
        inArray(
          restaurantLocations.restaurantId,
          rows.map((r) => r.id),
        ),
        eq(restaurantLocations.status, "active"),
      ),
    )
    .orderBy(restaurantLocations.sortOrder);

  const results = rows
    .map(({ coverImageKey, ...r }) => {
      const mine = locations.filter((l) => l.restaurantId === r.id);
      const pins = mine.flatMap((l) =>
        l.latitude !== null && l.longitude !== null
          ? [{ name: l.name, lat: l.latitude, lng: l.longitude }]
          : [],
      );
      const near = query.near;
      return {
        ...r,
        coverUrl: imageUrl(coverImageKey),
        cities: [...new Set(mine.map((l) => l.city))],
        bookingLocationSlug: mine.find((l) => l.reservationsEnabled)?.slug ?? null,
        openNow: mine.some((l) => isOpenAt(l.openingHours, l.timezone, now)),
        pins,
        distanceKm:
          near && pins.length > 0 ? Math.min(...pins.map((p) => distanceKm(near, p))) : null,
      };
    })
    .filter((r) => !query.openNow || r.openNow);
  if (query.sort === "distance" && query.near) {
    // Nearest first; restaurants without a pin go last, in their existing order.
    results.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }
  return { results: results.slice(0, query.limit), total: results.length };
}

/** Cities with at least one public restaurant, for the filter. */
export async function listSearchCities(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ city: restaurantLocations.city })
    .from(restaurantLocations)
    .innerJoin(restaurants, eq(restaurants.id, restaurantLocations.restaurantId))
    .where(and(eq(restaurants.status, "active"), eq(restaurantLocations.status, "active")))
    .orderBy(restaurantLocations.city);
  return rows.map((r) => r.city);
}

/** `%` and `_` typed by a guest are literal characters, not wildcards. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
