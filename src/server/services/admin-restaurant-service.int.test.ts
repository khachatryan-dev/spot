import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { restaurantLocations, users } from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import {
  approveRestaurant,
  getRestaurantForReview,
  listRestaurantsForAdmin,
  reinstateRestaurant,
  rejectRestaurant,
  suspendRestaurant,
} from "./admin-restaurant-service";
import { createRestaurant, getPublicRestaurant, submitForReview } from "./restaurant-service";

beforeEach(() =>
  truncate(db, ["restaurant_locations", "restaurant_staff", "restaurants", "users"]),
);

async function createUser(email: string, platformRole: "customer" | "platform_admin" = "customer") {
  const [user] = await db.insert(users).values({ email, platformRole }).returning();
  return user!;
}

async function pendingRestaurant(name = "Cafe") {
  const owner = await createUser(`owner-${name.toLowerCase()}@example.am`);
  const restaurant = await createRestaurant(owner, { name });
  await db.insert(restaurantLocations).values({
    restaurantId: restaurant.id,
    name: "Main",
    slug: "main",
    addressLine: "1 Abovyan",
    city: "Yerevan",
  });
  await submitForReview(owner, restaurant.id);
  return { owner, restaurant };
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).name),
  );

describe("admin restaurant review", () => {
  it("lists pending restaurants with owners and locations for review", async () => {
    const admin = await createUser("admin@example.am", "platform_admin");
    const { restaurant } = await pendingRestaurant();

    expect((await listRestaurantsForAdmin(admin)).map((r) => r.id)).toEqual([restaurant.id]);
    const review = await getRestaurantForReview(admin, restaurant.id);
    expect(review.owners).toEqual([{ name: null, email: "owner-cafe@example.am" }]);
    expect(review.locations).toHaveLength(1);
  });

  it("approves a pending restaurant and makes it public", async () => {
    const admin = await createUser("admin@example.am", "platform_admin");
    const { restaurant } = await pendingRestaurant();

    const approved = await approveRestaurant(admin, restaurant.id);
    expect(approved).toMatchObject({ status: "active", statusReason: null });
    expect(approved.approvedAt).toBeInstanceOf(Date);
    expect(await getPublicRestaurant(restaurant.slug)).not.toBeNull();
    expect(await codeOf(approveRestaurant(admin, restaurant.id))).toBe("CONFLICT");
  });

  it("rejects back to draft with a required reason", async () => {
    const admin = await createUser("admin@example.am", "platform_admin");
    const { restaurant } = await pendingRestaurant();

    expect(await codeOf(rejectRestaurant(admin, restaurant.id, { reason: "no" }))).toBe("ZodError");
    const rejected = await rejectRestaurant(admin, restaurant.id, {
      reason: "Please add a real street address.",
    });
    expect(rejected).toMatchObject({
      status: "draft",
      statusReason: "Please add a real street address.",
    });
  });

  it("suspends and reinstates active restaurants", async () => {
    const admin = await createUser("admin@example.am", "platform_admin");
    const { restaurant } = await pendingRestaurant();
    await approveRestaurant(admin, restaurant.id);

    await suspendRestaurant(admin, restaurant.id, { reason: "Repeated customer complaints." });
    expect(await getPublicRestaurant(restaurant.slug)).toBeNull();
    const reinstated = await reinstateRestaurant(admin, restaurant.id);
    expect(reinstated).toMatchObject({ status: "active", statusReason: null });
  });

  it("refuses invalid transitions", async () => {
    const admin = await createUser("admin@example.am", "platform_admin");
    const owner = await createUser("owner@example.am");
    const draft = await createRestaurant(owner, { name: "Draft" });

    expect(await codeOf(approveRestaurant(admin, draft.id))).toBe("CONFLICT"); // must be submitted first
    expect(await codeOf(suspendRestaurant(admin, draft.id, { reason: "Not even live yet." }))).toBe(
      "CONFLICT",
    );
  });

  it("is only available to platform admins", async () => {
    const { owner, restaurant } = await pendingRestaurant();

    expect(await codeOf(listRestaurantsForAdmin(owner))).toBe("FORBIDDEN");
    expect(await codeOf(approveRestaurant(owner, restaurant.id))).toBe("FORBIDDEN");
    expect(await codeOf(getRestaurantForReview(owner, restaurant.id))).toBe("FORBIDDEN");
  });
});
