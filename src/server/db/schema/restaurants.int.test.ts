import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { truncate } from "@/test/db";

import { restaurantLocations, restaurants } from "./restaurants";

beforeEach(() => truncate(db, ["restaurant_locations", "restaurant_staff", "restaurants"]));

async function createRestaurant(slug = "example-coffee") {
  const [restaurant] = await db.insert(restaurants).values({ name: "Example", slug }).returning();
  return restaurant!;
}

const location = (
  restaurantId: string,
  overrides: Partial<typeof restaurantLocations.$inferInsert> = {},
) => ({
  restaurantId,
  name: "Cascade",
  slug: "cascade",
  addressLine: "10 Tamanyan St",
  city: "Yerevan",
  ...overrides,
});

describe("restaurants", () => {
  it("defaults to a draft AMD restaurant with no cuisines", async () => {
    const restaurant = await createRestaurant();
    expect(restaurant).toMatchObject({ status: "draft", currency: "AMD", cuisines: [] });
  });

  it.each(["Example Coffee", "example_coffee", "-cafe", "cafe-", "café"])(
    "rejects slug %j",
    async (slug) => {
      await expect(createRestaurant(slug)).rejects.toThrow();
    },
  );

  it("rejects price ranges outside 1–4 and invalid currencies", async () => {
    await expect(
      db.insert(restaurants).values({ name: "A", slug: "a", priceRange: 5 }),
    ).rejects.toThrow();
    await expect(
      db.insert(restaurants).values({ name: "B", slug: "b", currency: "amd" }),
    ).rejects.toThrow();
  });
});

describe("restaurant locations", () => {
  it("defaults to active, Yerevan time, closed all week, reservations off", async () => {
    const restaurant = await createRestaurant();
    const [created] = await db
      .insert(restaurantLocations)
      .values(location(restaurant.id))
      .returning();

    expect(created).toMatchObject({
      status: "active",
      country: "AM",
      timezone: "Asia/Yerevan",
      reservationsEnabled: false,
    });
    expect(created?.openingHours.mon).toEqual([]);
  });

  it("stores opening hours as JSON", async () => {
    const restaurant = await createRestaurant();
    const openingHours = {
      mon: [{ open: "09:00", close: "22:00" }],
      tue: [],
      wed: [],
      thu: [],
      fri: [{ open: "18:00", close: "02:00" }],
      sat: [],
      sun: [],
    };
    const [created] = await db
      .insert(restaurantLocations)
      .values(location(restaurant.id, { openingHours }))
      .returning();
    expect(created?.openingHours).toEqual(openingHours);
  });

  it("keeps location slugs unique per restaurant only", async () => {
    const a = await createRestaurant("a");
    const b = await createRestaurant("b");
    await db.insert(restaurantLocations).values(location(a.id));
    await db.insert(restaurantLocations).values(location(b.id)); // same slug, other restaurant

    await expect(db.insert(restaurantLocations).values(location(a.id))).rejects.toThrow();
  });

  it("requires both coordinates within valid ranges", async () => {
    const restaurant = await createRestaurant();
    for (const coords of [
      { latitude: 40.18 },
      { latitude: 91, longitude: 44.51 },
      { latitude: 40.18, longitude: 181 },
    ]) {
      await expect(
        db.insert(restaurantLocations).values(location(restaurant.id, coords)),
      ).rejects.toThrow();
    }
    await expect(
      db
        .insert(restaurantLocations)
        .values(location(restaurant.id, { latitude: 40.1792, longitude: 44.4991 })),
    ).resolves.toBeDefined();
  });

  it("prevents deleting a restaurant that still has locations", async () => {
    const restaurant = await createRestaurant();
    await db.insert(restaurantLocations).values(location(restaurant.id));

    await expect(db.delete(restaurants).where(eq(restaurants.id, restaurant.id))).rejects.toThrow();
  });
});
