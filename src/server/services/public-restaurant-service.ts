import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { restaurantLocations, restaurants } from "@/server/db/schema";
import { isPubliclyVisible } from "@/shared/domain/restaurant-status";
import { imageUrl } from "@/shared/utils/image-url";

/*
 * The public restaurant page (§26, §39): only approved restaurants, only
 * active locations, and only public fields.
 */

export async function getPublicRestaurant(slug: string) {
  const [restaurant] = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      status: restaurants.status,
      description: restaurants.description,
      cuisines: restaurants.cuisines,
      priceRange: restaurants.priceRange,
      currency: restaurants.currency,
      phone: restaurants.phone,
      email: restaurants.email,
      website: restaurants.website,
      logoKey: restaurants.logoKey,
      coverImageKey: restaurants.coverImageKey,
      updatedAt: restaurants.updatedAt,
    })
    .from(restaurants)
    .where(eq(restaurants.slug, slug));
  if (!restaurant || !isPubliclyVisible(restaurant.status)) return null;

  const locations = await db
    .select({
      id: restaurantLocations.id,
      name: restaurantLocations.name,
      slug: restaurantLocations.slug,
      addressLine: restaurantLocations.addressLine,
      city: restaurantLocations.city,
      postalCode: restaurantLocations.postalCode,
      country: restaurantLocations.country,
      latitude: restaurantLocations.latitude,
      longitude: restaurantLocations.longitude,
      phone: restaurantLocations.phone,
      timezone: restaurantLocations.timezone,
      openingHours: restaurantLocations.openingHours,
      reservationsEnabled: restaurantLocations.reservationsEnabled,
    })
    .from(restaurantLocations)
    .where(
      and(
        eq(restaurantLocations.restaurantId, restaurant.id),
        eq(restaurantLocations.status, "active"),
      ),
    )
    .orderBy(asc(restaurantLocations.sortOrder), asc(restaurantLocations.createdAt));

  return {
    id: restaurant.id,
    name: restaurant.name,
    slug: restaurant.slug,
    description: restaurant.description,
    cuisines: restaurant.cuisines,
    priceRange: restaurant.priceRange,
    currency: restaurant.currency,
    phone: restaurant.phone,
    email: restaurant.email,
    website: restaurant.website,
    updatedAt: restaurant.updatedAt,
    logoUrl: imageUrl(restaurant.logoKey),
    coverUrl: imageUrl(restaurant.coverImageKey),
    locations,
  };
}

export type PublicRestaurant = NonNullable<Awaited<ReturnType<typeof getPublicRestaurant>>>;

/** Every approved restaurant with an active location, for the sitemap. */
export async function listPublicRestaurantsForSitemap() {
  return db
    .selectDistinct({ slug: restaurants.slug, updatedAt: restaurants.updatedAt })
    .from(restaurants)
    .innerJoin(
      restaurantLocations,
      and(
        eq(restaurantLocations.restaurantId, restaurants.id),
        eq(restaurantLocations.status, "active"),
      ),
    )
    .where(eq(restaurants.status, "active"))
    .orderBy(restaurants.slug);
}
