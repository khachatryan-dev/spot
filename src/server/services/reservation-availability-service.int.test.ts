import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  diningTables,
  reservationHolds,
  restaurantLocations,
  restaurants,
} from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import { getReservationAvailability } from "./reservation-availability-service";

beforeEach(() => truncate(db, ["restaurants"]));

/** 2030-01-18 is a Friday. Yerevan is UTC+4. */
const DATE = "2030-01-18";
const local = (hhmm: string, date = DATE) => new Date(`${date}T${hhmm}:00+04:00`);
const NOW = local("10:00", "2030-01-17");

async function setup(overrides: Partial<typeof restaurantLocations.$inferInsert> = {}) {
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: "Cafe", slug: "cafe", status: "active" })
    .returning();
  const [location] = await db
    .insert(restaurantLocations)
    .values({
      restaurantId: restaurant!.id,
      name: "Main",
      slug: "main",
      addressLine: "1 St",
      city: "Yerevan",
      reservationsEnabled: true,
      openingHours: {
        mon: [],
        tue: [],
        wed: [],
        thu: [],
        fri: [{ open: "18:00", close: "23:00" }],
        sat: [],
        sun: [],
      },
      ...overrides,
    })
    .returning();
  const addTable = async (number: string, capacity: number, extra = {}) => {
    const [t] = await db
      .insert(diningTables)
      .values({
        restaurantId: restaurant!.id,
        locationId: location!.id,
        number,
        capacity,
        ...extra,
      })
      .returning();
    return t!;
  };
  const hold = (tableId: string, from: string, to: string, extra = {}) =>
    db.insert(reservationHolds).values({
      restaurantId: restaurant!.id,
      tableId,
      startsAt: local(from),
      endsAt: local(to),
      ...extra,
    });
  const times = async (partySize: number, now = NOW, date = DATE) => {
    const result = await getReservationAvailability(
      restaurant!.id,
      location!.id,
      { date, partySize },
      now,
    );
    return result.available ? result.slots.map((s) => s.time) : result.reason;
  };
  return { restaurant: restaurant!, location: location!, addTable, hold, times };
}

const ALL = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00"];

describe("getReservationAvailability", () => {
  it("offers every time a fitting table is free for the whole booking", async () => {
    const { addTable, times } = await setup();
    await addTable("1", 4);
    expect(await times(2)).toEqual(ALL); // last start 21:00 ends at 23:00 closing
    expect(await times(5)).toEqual([]); // no table that big
  });

  it("returns UTC instants alongside local times", async () => {
    const { addTable, restaurant, location } = await setup();
    await addTable("1", 4);
    const result = await getReservationAvailability(
      restaurant.id,
      location.id,
      { date: DATE, partySize: 2 },
      NOW,
    );
    expect(result).toMatchObject({
      available: true,
      timezone: "Asia/Yerevan",
      durationMinutes: 120,
    });
    if (result.available) expect(result.slots[0]!.startsAt).toEqual(local("18:00"));
  });

  it("hides times whose only fitting table is held, but not back-to-back ones", async () => {
    const { addTable, hold, times } = await setup();
    const table = await addTable("1", 4);
    await hold(table.id, "19:00", "21:00");
    // 18:00–20:00 overlaps; 21:00–23:00 starts as the hold ends.
    expect(await times(2)).toEqual(["21:00"]);
  });

  it("uses another table when one is held", async () => {
    const { addTable, hold, times } = await setup();
    const small = await addTable("1", 2);
    await addTable("2", 6);
    await hold(small.id, "18:00", "23:00");
    expect(await times(2)).toEqual(ALL);
  });

  it("ignores released and expired holds, counts unexpired ones", async () => {
    const { addTable, hold, times } = await setup();
    const table = await addTable("1", 4);
    await hold(table.id, "18:00", "20:00", { releasedAt: NOW });
    await hold(table.id, "20:00", "22:00", { expiresAt: new Date(NOW.getTime() - 1) });
    expect(await times(2)).toEqual(ALL);

    await hold(table.id, "18:00", "19:00", { expiresAt: new Date(NOW.getTime() + 60_000) });
    expect(await times(2)).toEqual(["19:00", "19:30", "20:00", "20:30", "21:00"]);
  });

  it("never offers inactive, blocked or out-of-service tables", async () => {
    const { addTable, times } = await setup();
    await addTable("1", 4, { isActive: false });
    await addTable("2", 4, { status: "blocked" });
    await addTable("3", 4, { status: "out_of_service" });
    expect(await times(2)).toEqual([]);
    await addTable("4", 4, { status: "occupied" }); // occupied now ≠ occupied on Friday
    expect(await times(2)).toEqual(ALL);
  });

  it("applies minimum notice and the days-ahead limit", async () => {
    const { addTable, times } = await setup({ reservationMaxDaysAhead: 7 });
    await addTable("1", 4);
    expect(await times(2, local("17:30"))).toEqual(ALL.slice(1)); // 1 hour notice → 18:30 on
    expect(await times(2, local("22:00"))).toEqual([]);
    expect(await times(2, local("10:00", "2030-01-11"))).toEqual(ALL); // 7 days ahead
    expect(await times(2, local("23:00", "2030-01-10"))).toEqual([]); // 8 days ahead
  });

  it("offers nothing on closed days", async () => {
    const { addTable, times } = await setup();
    await addTable("1", 4);
    expect(await times(2, NOW, "2030-01-19")).toEqual([]); // Saturday
  });

  it("offers nothing when no opening hours are set", async () => {
    const { addTable, times } = await setup({
      openingHours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
    });
    await addTable("1", 4);
    expect(await times(2)).toEqual([]);
  });

  it("says when reservations are off, and hides non-public locations", async () => {
    const { restaurant, location, addTable, times } = await setup({ reservationsEnabled: false });
    await addTable("1", 4);
    expect(await times(2)).toBe("disabled");

    const notFound = { code: "NOT_FOUND" };
    await db
      .update(restaurants)
      .set({ status: "suspended" })
      .where(eq(restaurants.id, restaurant.id));
    await expect(times(2)).rejects.toMatchObject(notFound);
    await db.update(restaurants).set({ status: "active" }).where(eq(restaurants.id, restaurant.id));
    await db
      .update(restaurantLocations)
      .set({ status: "inactive" })
      .where(eq(restaurantLocations.id, location.id));
    await expect(times(2)).rejects.toMatchObject(notFound);
    const query = { date: DATE, partySize: 2 };
    await expect(
      getReservationAvailability(restaurant.id, "not-a-uuid", query),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("validates the date and party size", async () => {
    const { restaurant, location } = await setup();
    for (const query of [
      { date: "2030-02-30", partySize: 2 },
      { date: "18.01.2030", partySize: 2 },
      { date: DATE, partySize: 0 },
      { date: DATE, partySize: 51 },
    ]) {
      await expect(
        getReservationAvailability(restaurant.id, location.id, query, NOW),
      ).rejects.toThrow();
    }
  });
});
