import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { restaurantLocations, restaurants, restaurantStaff, users } from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import {
  createRestaurant,
  getPublicRestaurant,
  getRestaurant,
  listMyRestaurants,
  MAX_UNPUBLISHED_RESTAURANTS,
  submitForReview,
  updateRestaurant,
} from "./restaurant-service";

beforeEach(() =>
  truncate(db, ["restaurant_locations", "restaurant_staff", "restaurants", "users"]),
);

async function createUser(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  return user!;
}

async function addLocation(restaurantId: string) {
  await db.insert(restaurantLocations).values({
    restaurantId,
    name: "Cascade",
    slug: "cascade",
    addressLine: "10 Tamanyan St",
    city: "Yerevan",
  });
}

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (error instanceof AppError) return error.code;
  return (error as { name?: string })?.name ?? error;
}

describe("createRestaurant", () => {
  it("creates a draft restaurant with the creator as owner", async () => {
    const ani = await createUser("ani@example.am");
    const restaurant = await createRestaurant(ani, { name: "Կասկադ Սրճարան" });

    expect(restaurant).toMatchObject({ status: "draft", slug: "kaskad-srcharan" });
    const [staff] = await db.select().from(restaurantStaff);
    expect(staff).toMatchObject({ userId: ani.id, restaurantId: restaurant.id, role: "owner" });
  });

  it("gives restaurants with the same name distinct slugs", async () => {
    const a = await createUser("a@example.am");
    const b = await createUser("b@example.am");
    const first = await createRestaurant(a, { name: "Example Coffee" });
    const second = await createRestaurant(b, { name: "Example Coffee" });
    expect([first.slug, second.slug]).toEqual(["example-coffee", "example-coffee-2"]);
  });

  it("ignores status and slug sent by the client", async () => {
    const ani = await createUser("ani@example.am");
    const restaurant = await createRestaurant(ani, {
      name: "Cafe",
      ...({ status: "active", slug: "hijack" } as object),
    });
    expect(restaurant).toMatchObject({ status: "draft", slug: "cafe" });
  });

  it("validates input", async () => {
    const ani = await createUser("ani@example.am");
    expect(await codeOf(createRestaurant(ani, { name: "x" }))).toBe("ZodError");
    expect(await codeOf(createRestaurant(ani, { name: "Cafe", priceRange: 9 }))).toBe("ZodError");
  });

  it(`limits a user to ${MAX_UNPUBLISHED_RESTAURANTS} unpublished restaurants`, async () => {
    const ani = await createUser("ani@example.am");
    for (let i = 0; i < MAX_UNPUBLISHED_RESTAURANTS; i++) {
      await createRestaurant(ani, { name: `Cafe ${i}` });
    }
    expect(await codeOf(createRestaurant(ani, { name: "One too many" }))).toBe("CONFLICT");
  });
});

describe("tenant scoping", () => {
  it("lists only the actor's restaurants", async () => {
    const ani = await createUser("ani@example.am");
    const bob = await createUser("bob@example.am");
    await createRestaurant(ani, { name: "Ani Cafe" });
    await createRestaurant(bob, { name: "Bob Bistro" });

    expect((await listMyRestaurants(ani)).map((r) => r.restaurant.name)).toEqual(["Ani Cafe"]);
  });

  it("hides other tenants' restaurants as NOT_FOUND", async () => {
    const ani = await createUser("ani@example.am");
    const bob = await createUser("bob@example.am");
    const bobs = await createRestaurant(bob, { name: "Bob Bistro" });

    expect(await codeOf(getRestaurant(ani, bobs.id))).toBe("NOT_FOUND");
    expect(await codeOf(updateRestaurant(ani, bobs.id, { name: "Pwned" }))).toBe("NOT_FOUND");
    expect(await codeOf(submitForReview(ani, bobs.id))).toBe("NOT_FOUND");
  });
});

describe("updateRestaurant", () => {
  it("lets the owner edit the profile", async () => {
    const ani = await createUser("ani@example.am");
    const restaurant = await createRestaurant(ani, { name: "Cafe" });

    const updated = await updateRestaurant(ani, restaurant.id, {
      description: "Best coffee",
      website: "https://cafe.am",
      email: "Hello@Cafe.AM",
    });
    expect(updated).toMatchObject({ description: "Best coffee", email: "hello@cafe.am" });
  });

  it("leaves fields that are not part of the update untouched", async () => {
    const ani = await createUser("ani@example.am");
    const restaurant = await createRestaurant(ani, {
      name: "Cafe",
      cuisines: ["coffee", "desserts"],
      priceRange: 2,
    });

    const updated = await updateRestaurant(ani, restaurant.id, { description: "New text" });
    expect(updated).toMatchObject({ cuisines: ["coffee", "desserts"], priceRange: 2 });
  });

  it("forbids managers and cannot change status or slug", async () => {
    const ani = await createUser("ani@example.am");
    const manager = await createUser("manager@example.am");
    const restaurant = await createRestaurant(ani, { name: "Cafe" });
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: restaurant.id, userId: manager.id, role: "manager" });

    expect(await codeOf(updateRestaurant(manager, restaurant.id, { name: "X" }))).toBe("FORBIDDEN");

    await updateRestaurant(ani, restaurant.id, {
      ...({ status: "active", slug: "other" } as object),
    });
    const [row] = await db.select().from(restaurants);
    expect(row).toMatchObject({ status: "draft", slug: "cafe" });
  });
});

describe("submitForReview", () => {
  it("requires an active location", async () => {
    const ani = await createUser("ani@example.am");
    const restaurant = await createRestaurant(ani, { name: "Cafe" });
    expect(await codeOf(submitForReview(ani, restaurant.id))).toBe("VALIDATION_ERROR");
  });

  it("moves a draft to pending review once", async () => {
    const ani = await createUser("ani@example.am");
    const restaurant = await createRestaurant(ani, { name: "Cafe" });
    await addLocation(restaurant.id);

    const submitted = await submitForReview(ani, restaurant.id);
    expect(submitted.status).toBe("pending_review");
    expect(submitted.submittedAt).toBeInstanceOf(Date);

    expect(await codeOf(submitForReview(ani, restaurant.id))).toBe("CONFLICT");
  });
});

describe("getPublicRestaurant", () => {
  it("returns only active restaurants, without internal fields", async () => {
    const ani = await createUser("ani@example.am");
    const restaurant = await createRestaurant(ani, { name: "Cafe" });
    expect(await getPublicRestaurant("cafe")).toBeNull();

    await db
      .update(restaurants)
      .set({ status: "active", statusReason: "internal note" })
      .where(eq(restaurants.id, restaurant.id));
    const publicView = await getPublicRestaurant("cafe");
    expect(publicView?.name).toBe("Cafe");
    expect(publicView).not.toHaveProperty("status");
    expect(publicView).not.toHaveProperty("statusReason");
  });
});
