import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  diningTables,
  restaurantLocations,
  restaurants,
  reviews,
  tableSessions,
} from "@/server/db/schema";
import { CUISINES, type Cuisine } from "@/shared/constants/cuisines";
import { truncate } from "@/test/db";

import { searchQuerySchema, searchRestaurants } from "./restaurant-search-service";

beforeEach(() => truncate(db, ["restaurants"]));

const names = Object.fromEntries(CUISINES.map((c) => [c, [c]])) as Record<Cuisine, string[]>;
names.armenian = ["Armenian", "Հայկական"];
names.georgian = ["Georgian", "Վրացական"];

/** Friday 2030-01-18, 20:00 in Yerevan. */
const FRIDAY_EVENING = new Date("2030-01-18T20:00:00+04:00");
const everyDay = (open: string, close: string) => {
  const day = [{ open, close }];
  return { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
};

let codes = 0;
async function restaurant(input: {
  name: string;
  cuisines?: Cuisine[];
  price?: number;
  city?: string;
  status?: "active" | "draft";
  description?: string;
  reservations?: boolean;
  hours?: ReturnType<typeof everyDay>;
  at?: { lat: number; lng: number };
  ratings?: number[];
  approvedAt?: Date;
}) {
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const [r] = await db
    .insert(restaurants)
    .values({
      name: input.name,
      slug,
      status: input.status ?? "active",
      cuisines: input.cuisines ?? [],
      priceRange: input.price ?? null,
      description: input.description ?? null,
      approvedAt: input.approvedAt ?? new Date("2030-01-01"),
    })
    .returning();
  const [location] = await db
    .insert(restaurantLocations)
    .values({
      restaurantId: r!.id,
      name: "Main",
      slug: "main",
      addressLine: "1 St",
      city: input.city ?? "Yerevan",
      reservationsEnabled: input.reservations ?? false,
      openingHours: input.hours ?? everyDay("10:00", "22:00"),
      latitude: input.at?.lat ?? null,
      longitude: input.at?.lng ?? null,
    })
    .returning();
  for (const rating of input.ratings ?? []) {
    const [table] = await db
      .insert(diningTables)
      .values({ restaurantId: r!.id, locationId: location!.id, number: String(++codes) })
      .returning();
    const [session] = await db
      .insert(tableSessions)
      .values({
        restaurantId: r!.id,
        tableId: table!.id,
        code: `S${String(codes).padStart(5, "0")}`,
      })
      .returning();
    await db.insert(reviews).values({
      restaurantId: r!.id,
      locationId: location!.id,
      subject: "visit",
      tableSessionId: session!.id,
      displayName: "Guest",
      rating,
      status: "published",
      publishedAt: new Date(),
    });
  }
  return r!;
}

const search = async (query: Record<string, unknown>, now = FRIDAY_EVENING) =>
  (await searchRestaurants(searchQuerySchema.parse(query), names, now)).results.map((r) => r.name);

async function town() {
  await restaurant({
    name: "Ararat Grill",
    cuisines: ["armenian", "grill"],
    price: 2,
    description: "Khorovats on the fire",
    reservations: true,
    ratings: [5, 4],
  });
  await restaurant({
    name: "Tbilisi House",
    cuisines: ["georgian"],
    price: 3,
    city: "Gyumri",
    hours: everyDay("08:00", "12:00"),
    ratings: [3, 3, 3],
  });
  await restaurant({
    name: "Lavash Corner",
    cuisines: ["armenian"],
    price: 1,
    approvedAt: new Date("2030-01-10"),
  });
  await restaurant({ name: "Hidden Cafe", status: "draft", cuisines: ["armenian"] });
}

describe("searchRestaurants", () => {
  it("only finds approved restaurants", async () => {
    await town();
    expect((await search({})).sort()).toEqual(["Ararat Grill", "Lavash Corner", "Tbilisi House"]);
    expect(await search({ q: "hidden" })).toEqual([]);
  });

  it("matches names with typos, descriptions, and cuisines by any language's name", async () => {
    await town();
    expect(await search({ q: "ararat" })).toEqual(["Ararat Grill"]);
    expect(await search({ q: "arrarat" })).toEqual(["Ararat Grill"]);
    expect(await search({ q: "khorovats" })).toEqual(["Ararat Grill"]);
    expect((await search({ q: "Հայկական" })).sort()).toEqual(["Ararat Grill", "Lavash Corner"]);
    expect(await search({ q: "georgian" })).toEqual(["Tbilisi House"]);
    expect(await search({ q: "%" })).toEqual([]); // not a wildcard
  });

  it("filters by cuisine, price, city, reservations and opening hours", async () => {
    await town();
    expect((await search({ cuisine: "armenian" })).sort()).toEqual([
      "Ararat Grill",
      "Lavash Corner",
    ]);
    expect(await search({ price: "3" })).toEqual(["Tbilisi House"]);
    expect(await search({ city: "gyumri" })).toEqual(["Tbilisi House"]);
    expect(await search({ reservable: "1" })).toEqual(["Ararat Grill"]);
    expect(await search({ reservable: "false" })).toHaveLength(3);
    // 20:00 on Friday: Tbilisi House (08–12) is closed.
    expect((await search({ openNow: "1" })).sort()).toEqual(["Ararat Grill", "Lavash Corner"]);
  });

  it("sorts by rating, number of reviews or newest, and pages", async () => {
    await town();
    expect(await search({ sort: "rating" })).toEqual([
      "Ararat Grill",
      "Tbilisi House",
      "Lavash Corner",
    ]);
    expect(await search({ sort: "reviews" })).toEqual([
      "Tbilisi House",
      "Ararat Grill",
      "Lavash Corner",
    ]);
    expect((await search({ sort: "newest" }))[0]).toBe("Lavash Corner");
    for (let i = 0; i < 14; i++) await restaurant({ name: `Cafe ${i}` });
    const page = await searchRestaurants(searchQuerySchema.parse({}), names, FRIDAY_EVENING);
    expect(page.results).toHaveLength(12);
    expect(page.total).toBe(17);
  });

  it("returns ratings, cities, the booking location and whether it's open", async () => {
    await town();
    const { results } = await searchRestaurants(
      searchQuerySchema.parse({ q: "ararat" }),
      names,
      FRIDAY_EVENING,
    );
    expect(results[0]).toMatchObject({
      rating: 4.5,
      reviewCount: 2,
      cities: ["Yerevan"],
      bookingLocationSlug: "main",
      openNow: true,
      priceRange: 2,
    });
  });

  it("sorts by distance from the guest when they share their position", async () => {
    await restaurant({ name: "Cascade Cafe", at: { lat: 40.1913, lng: 44.5152 } });
    await restaurant({ name: "Square Bistro", at: { lat: 40.1777, lng: 44.5126 } });
    await restaurant({ name: "No Pin Place" });
    const nearSquare = { near: "40.178,44.513", sort: "distance" };
    expect(await search(nearSquare)).toEqual(["Square Bistro", "Cascade Cafe", "No Pin Place"]);
    const { results } = await searchRestaurants(
      searchQuerySchema.parse(nearSquare),
      names,
      FRIDAY_EVENING,
    );
    expect(results[0]!.distanceKm).toBeLessThan(0.2);
    expect(results[1]!.distanceKm).toBeCloseTo(1.45, 1);
    expect(results[2]!.distanceKm).toBeNull();
    expect(results[0]!.pins).toEqual([{ name: "Main", lat: 40.1777, lng: 44.5126 }]);
    // Without a position, "distance" falls back to the usual order.
    expect(await search({ sort: "distance" })).toHaveLength(3);
  });

  it("ignores nonsense in the URL", () => {
    expect(
      searchQuerySchema.parse({ cuisine: "martian", price: "9", sort: "random", limit: "99999" }),
    ).toMatchObject({
      cuisine: undefined,
      price: undefined,
      sort: "rating",
      limit: 12,
      near: null,
    });
    expect(searchQuerySchema.parse({ near: "not,a,place" }).near).toBeNull();
  });
});
