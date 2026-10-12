import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { restaurants, restaurantStaff, users } from "@/server/db/schema";
import type { RestaurantRole } from "@/shared/constants/roles";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import { authorizePlatform, authorizeRestaurant } from "./restaurant-access";

beforeEach(() => truncate(db, ["restaurant_staff", "restaurants", "users"]));

async function createUser(email: string, platformRole: "customer" | "platform_admin" = "customer") {
  const [user] = await db.insert(users).values({ email, platformRole }).returning();
  return user!;
}

async function createRestaurant(slug: string) {
  const [restaurant] = await db.insert(restaurants).values({ name: slug, slug }).returning();
  return restaurant!;
}

async function addStaff(restaurantId: string, userId: string, role: RestaurantRole) {
  await db.insert(restaurantStaff).values({ restaurantId, userId, role });
}

async function errorCode(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  return error instanceof AppError ? error.code : error;
}

describe("authorizeRestaurant", () => {
  it("allows a member whose role has the permission", async () => {
    const ani = await createUser("ani@example.am");
    const cafe = await createRestaurant("cafe");
    await addStaff(cafe.id, ani.id, "manager");

    await expect(authorizeRestaurant(ani.id, cafe.id, "menu:manage")).resolves.toMatchObject({
      restaurantId: cafe.id,
      role: "manager",
    });
  });

  it("forbids a member whose role lacks the permission", async () => {
    const cook = await createUser("cook@example.am");
    const cafe = await createRestaurant("cafe");
    await addStaff(cafe.id, cook.id, "kitchen");

    expect(await errorCode(authorizeRestaurant(cook.id, cafe.id, "bill:read"))).toBe("FORBIDDEN");
  });

  it("isolates tenants: staff of one restaurant cannot reach another", async () => {
    const owner = await createUser("owner@example.am");
    const cafe = await createRestaurant("cafe");
    const rival = await createRestaurant("rival");
    await addStaff(cafe.id, owner.id, "owner");

    expect(await errorCode(authorizeRestaurant(owner.id, rival.id, "order:read"))).toBe(
      "NOT_FOUND",
    );
  });

  it("denies disabled staff", async () => {
    const ani = await createUser("ani@example.am");
    const cafe = await createRestaurant("cafe");
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: cafe.id, userId: ani.id, role: "owner", status: "disabled" });

    expect(await errorCode(authorizeRestaurant(ani.id, cafe.id, "restaurant:read"))).toBe(
      "NOT_FOUND",
    );
  });

  it("treats malformed restaurant ids as not found instead of crashing", async () => {
    const ani = await createUser("ani@example.am");
    for (const id of ["1", "' OR 1=1 --", ""]) {
      expect(await errorCode(authorizeRestaurant(ani.id, id, "restaurant:read"))).toBe("NOT_FOUND");
    }
  });

  it("gives platform admins no implicit access to restaurant data", async () => {
    const admin = await createUser("admin@example.am", "platform_admin");
    const cafe = await createRestaurant("cafe");

    expect(await errorCode(authorizeRestaurant(admin.id, cafe.id, "order:read"))).toBe("NOT_FOUND");
  });

  it("allows one role per person per restaurant", async () => {
    const ani = await createUser("ani@example.am");
    const cafe = await createRestaurant("cafe");
    await addStaff(cafe.id, ani.id, "waiter");

    await expect(addStaff(cafe.id, ani.id, "manager")).rejects.toThrow();
  });
});

describe("authorizePlatform", () => {
  it("allows platform admins and forbids customers", () => {
    expect(() =>
      authorizePlatform({ platformRole: "platform_admin" }, "platform:restaurants:review"),
    ).not.toThrow();
    expect(() =>
      authorizePlatform({ platformRole: "customer" }, "platform:restaurants:review"),
    ).toThrow(AppError);
  });
});
