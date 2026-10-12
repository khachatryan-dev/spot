import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { restaurantStaff, users } from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import { createLocation, getLocation, listLocations, updateLocation } from "./location-service";
import { createRestaurant, submitForReview } from "./restaurant-service";

beforeEach(() =>
  truncate(db, ["restaurant_locations", "restaurant_staff", "restaurants", "users"]),
);

async function createUser(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  return user!;
}

const cascade = { name: "Կասկադ", addressLine: "10 Tamanyan St", city: "Yerevan" };

describe("locations", () => {
  it("lets the owner add locations with unique slugs and lists them", async () => {
    const ani = await createUser("ani@example.am");
    const restaurant = await createRestaurant(ani, { name: "Cafe" });

    const first = await createLocation(ani, restaurant.id, cascade);
    const second = await createLocation(ani, restaurant.id, cascade);
    expect([first.slug, second.slug]).toEqual(["kaskad", "kaskad-2"]);
    expect(await listLocations(ani, restaurant.id)).toHaveLength(2);
  });

  it("keeps locations within their tenant and the owner role", async () => {
    const ani = await createUser("ani@example.am");
    const bob = await createUser("bob@example.am");
    const waiter = await createUser("waiter@example.am");
    const restaurant = await createRestaurant(ani, { name: "Cafe" });
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: restaurant.id, userId: waiter.id, role: "waiter" });

    const codeOf = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: unknown) => (e instanceof AppError ? e.code : e),
      );
    expect(await codeOf(createLocation(bob, restaurant.id, cascade))).toBe("NOT_FOUND");
    expect(await codeOf(listLocations(bob, restaurant.id))).toBe("NOT_FOUND");
    expect(await codeOf(createLocation(waiter, restaurant.id, cascade))).toBe("FORBIDDEN");
  });
});

describe("updateLocation", () => {
  const codeOf = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => (e instanceof AppError ? e.code : (e as Error).name),
    );

  it("updates hours, coordinates and settings", async () => {
    const ani = await createUser("ani@example.am");
    const restaurant = await createRestaurant(ani, { name: "Cafe" });
    const location = await createLocation(ani, restaurant.id, cascade);

    const updated = await updateLocation(ani, restaurant.id, location.id, {
      latitude: "40.1792",
      longitude: "44.4991",
      reservationsEnabled: true,
      openingHours: {
        mon: [{ open: "09:00", close: "22:00" }],
        fri: [{ open: "18:00", close: "02:00" }],
      },
    });
    expect(updated).toMatchObject({
      latitude: 40.1792,
      longitude: 44.4991,
      reservationsEnabled: true,
    });
    expect(updated.openingHours.fri).toEqual([{ open: "18:00", close: "02:00" }]);
    expect(updated.openingHours.sun).toEqual([]);
    expect(updated.slug).toBe(location.slug);
  });

  it("saves reservation settings, rejecting values out of range", async () => {
    const ani = await createUser("ani@example.am");
    const restaurant = await createRestaurant(ani, { name: "Cafe" });
    const location = await createLocation(ani, restaurant.id, cascade);

    const updated = await updateLocation(ani, restaurant.id, location.id, {
      reservationConfirmation: "auto",
      reservationDurationMinutes: "90", // form selects send strings
      reservationMinNoticeMinutes: 0,
      reservationMaxDaysAhead: 60,
    });
    expect(updated).toMatchObject({
      reservationConfirmation: "auto",
      reservationDurationMinutes: 90,
      reservationMinNoticeMinutes: 0,
      reservationMaxDaysAhead: 60,
    });
    for (const bad of [
      { reservationDurationMinutes: 10 },
      { reservationMinNoticeMinutes: -5 },
      { reservationMaxDaysAhead: 400 },
      { reservationConfirmation: "maybe" as "auto" },
    ]) {
      expect(await codeOf(updateLocation(ani, restaurant.id, location.id, bad))).toBe("ZodError");
    }
  });

  it("treats a location of another restaurant as not found, even with a valid id", async () => {
    const ani = await createUser("ani@example.am");
    const bob = await createUser("bob@example.am");
    const anis = await createRestaurant(ani, { name: "Ani Cafe" });
    const bobs = await createRestaurant(bob, { name: "Bob Bistro" });
    const bobsLocation = await createLocation(bob, bobs.id, cascade);

    // Ani passes her own restaurant id with Bob's location id.
    expect(await codeOf(getLocation(ani, anis.id, bobsLocation.id))).toBe("NOT_FOUND");
    expect(await codeOf(updateLocation(ani, anis.id, bobsLocation.id, { name: "Pwned" }))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(getLocation(ani, anis.id, "not-a-uuid"))).toBe("NOT_FOUND");
  });

  it("forbids staff without location:manage", async () => {
    const ani = await createUser("ani@example.am");
    const manager = await createUser("manager@example.am");
    const restaurant = await createRestaurant(ani, { name: "Cafe" });
    const location = await createLocation(ani, restaurant.id, cascade);
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: restaurant.id, userId: manager.id, role: "manager" });

    expect(await codeOf(updateLocation(manager, restaurant.id, location.id, { name: "X" }))).toBe(
      "FORBIDDEN",
    );
    await expect(getLocation(manager, restaurant.id, location.id)).resolves.toBeDefined();
  });

  it("keeps at least one active location once the restaurant is submitted", async () => {
    const ani = await createUser("ani@example.am");
    const restaurant = await createRestaurant(ani, { name: "Cafe" });
    const first = await createLocation(ani, restaurant.id, cascade);
    await submitForReview(ani, restaurant.id);

    expect(await codeOf(updateLocation(ani, restaurant.id, first.id, { status: "inactive" }))).toBe(
      "CONFLICT",
    );

    const second = await createLocation(ani, restaurant.id, { ...cascade, name: "Arabkir" });
    await expect(
      updateLocation(ani, restaurant.id, first.id, { status: "inactive" }),
    ).resolves.toMatchObject({ status: "inactive" });
    expect(
      await codeOf(updateLocation(ani, restaurant.id, second.id, { status: "inactive" })),
    ).toBe("CONFLICT");
  });

  it("rejects invalid input", async () => {
    const ani = await createUser("ani@example.am");
    const restaurant = await createRestaurant(ani, { name: "Cafe" });
    const location = await createLocation(ani, restaurant.id, cascade);

    expect(
      await codeOf(
        updateLocation(ani, restaurant.id, location.id, { latitude: "40", longitude: "" }),
      ),
    ).toBe("ZodError");
  });
});
