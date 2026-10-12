import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  reservationHolds,
  reservations,
  restaurantLocations,
  restaurants,
} from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { guest, local, MINUTE, NOW, reservationSetup } from "@/test/reservation-fixtures";

import {
  getLiveGuestHold,
  placeReservationHold,
  releaseExpiredHolds,
  releaseReservationHold,
} from "./reservation-hold-service";

beforeEach(() => truncate(db, ["restaurants", "users", "rate_limits"]));

async function setup(tableSizes: number[] = [4]) {
  const { holdInput, ...rest } = await reservationSetup(tableSizes);
  return { ...rest, input: holdInput };
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

const liveHolds = () =>
  db.select().from(reservationHolds).where(isNull(reservationHolds.releasedAt));

describe("placeReservationHold", () => {
  it("holds the smallest fitting table for the booking length, for 10 minutes", async () => {
    const { tables, input } = await setup([8, 2, 4]);
    const hold = await placeReservationHold(await guest("a@x.am"), input("19:00", 2), NOW);
    expect(hold).toMatchObject({
      tableId: tables.find((t) => t.capacity === 2)!.id,
      startsAt: local("19:00"),
      endsAt: local("21:00"),
      expiresAt: new Date(NOW.getTime() + 10 * MINUTE),
    });
  });

  it("refuses times the location doesn't offer", async () => {
    const { input } = await setup();
    const anna = await guest("a@x.am");
    for (const [time, date] of [
      ["19:10", undefined], // not on the 30-minute grid
      ["17:30", undefined], // before opening
      ["00:30", "2030-01-19"], // ends after the 02:00 close
      ["19:00", "2030-01-19"], // Saturday: closed
    ] as const) {
      expect(await codeOf(placeReservationHold(anna, input(time, 2, date), NOW))).toBe(
        "RESERVATION_UNAVAILABLE",
      );
    }
    // Friday's overnight period: 00:00 Saturday is still offered.
    await placeReservationHold(anna, input("00:00", 2, "2030-01-19"), NOW);
    // Too soon: 1 hour notice.
    expect(await codeOf(placeReservationHold(anna, input("19:00"), local("18:30")))).toBe(
      "RESERVATION_UNAVAILABLE",
    );
  });

  it("gives the last table to one of two guests racing for it", async () => {
    const { input } = await setup([4]);
    const [anna, ben] = [await guest("a@x.am"), await guest("b@x.am")];
    const results = await Promise.all([
      codeOf(placeReservationHold(anna, input(), NOW)),
      codeOf(placeReservationHold(ben, input(), NOW)),
    ]);
    expect(results.sort()).toEqual([null, "RESERVATION_UNAVAILABLE"].sort());
    expect(await liveHolds()).toHaveLength(1);
  });

  it("seats racing guests at different tables when there are enough", async () => {
    const { input } = await setup([4, 4, 4]);
    const people = await Promise.all(["a", "b", "c", "d"].map((n) => guest(`${n}@x.am`)));
    const results = await Promise.all(
      people.map((p) => codeOf(placeReservationHold(p, input(), NOW))),
    );
    expect(results.filter((r) => r === null)).toHaveLength(3);
    expect(results.filter((r) => r === "RESERVATION_UNAVAILABLE")).toHaveLength(1);
    const tableIds = (await liveHolds()).map((h) => h.tableId);
    expect(new Set(tableIds).size).toBe(3);
  });

  it("frees the slot once a hold expires", async () => {
    const { input } = await setup([4]);
    const [anna, ben] = [await guest("a@x.am"), await guest("b@x.am")];
    const first = await placeReservationHold(anna, input(), NOW);
    expect(await codeOf(placeReservationHold(ben, input(), NOW))).toBe("RESERVATION_UNAVAILABLE");

    const later = new Date(NOW.getTime() + 10 * MINUTE);
    const second = await placeReservationHold(ben, input(), later);
    const [old] = await db.select().from(reservationHolds).where(eq(reservationHolds.id, first.id));
    expect(old!.releasedAt).toEqual(later);
    expect(second.tableId).toBe(first.tableId);
  });

  it("replaces the guest's earlier pick, but keeps it if the new time is taken", async () => {
    const { input } = await setup([4]);
    const [anna, ben] = [await guest("a@x.am"), await guest("b@x.am")];
    const first = await placeReservationHold(anna, input("19:00"), NOW);
    const second = await placeReservationHold(anna, input("21:00"), NOW);
    expect((await liveHolds()).map((h) => h.id)).toEqual([second.id]);
    expect(first.id).not.toBe(second.id);

    await placeReservationHold(ben, input("18:00"), NOW); // 18:00–20:00
    expect(await codeOf(placeReservationHold(anna, input("19:00"), NOW))).toBe(
      "RESERVATION_UNAVAILABLE",
    );
    expect((await liveHolds()).map((h) => h.id)).toContain(second.id);
  });

  it("doesn't take staff blocks or reservations for a guest's earlier pick", async () => {
    const { restaurant, tables, input } = await setup([4, 4]);
    const anna = await guest("a@x.am");
    await db.insert(reservationHolds).values({
      restaurantId: restaurant.id,
      tableId: tables[0]!.id,
      createdByUserId: anna.id, // e.g. an owner booking for themselves
      startsAt: local("22:00"),
      endsAt: local("23:00"),
    });
    await placeReservationHold(anna, input("19:00"), NOW);
    expect(await liveHolds()).toHaveLength(2);
  });

  it("refuses unknown, non-public and reservation-less locations", async () => {
    const { restaurant, location, input } = await setup();
    const anna = await guest("a@x.am");
    expect(
      await codeOf(placeReservationHold(anna, { ...input(), locationId: restaurant.id }, NOW)),
    ).toBe("NOT_FOUND");
    await db
      .update(restaurantLocations)
      .set({ reservationsEnabled: false })
      .where(eq(restaurantLocations.id, location.id));
    expect(await codeOf(placeReservationHold(anna, input(), NOW))).toBe("RESERVATION_UNAVAILABLE");
    await db
      .update(restaurants)
      .set({ status: "suspended" })
      .where(eq(restaurants.id, restaurant.id));
    expect(await codeOf(placeReservationHold(anna, input(), NOW))).toBe("NOT_FOUND");
  });

  it("limits how often one guest can grab tables", async () => {
    const { input } = await setup([4]);
    const anna = await guest("a@x.am");
    for (let i = 0; i < 20; i++) await placeReservationHold(anna, input(), NOW);
    expect(await codeOf(placeReservationHold(anna, input(), NOW))).toBe("RATE_LIMITED");
  });
});

describe("releasing holds", () => {
  it("lets a guest give back only their own unfinished hold", async () => {
    const { input } = await setup([4]);
    const [anna, ben] = [await guest("a@x.am"), await guest("b@x.am")];
    const hold = await placeReservationHold(anna, input(), NOW);
    await releaseReservationHold(ben, hold.id);
    expect(await liveHolds()).toHaveLength(1);
    await releaseReservationHold(anna, hold.id);
    expect(await liveHolds()).toHaveLength(0);
    await releaseReservationHold(anna, "not-a-uuid"); // ignored
  });

  it("finds a live hold for its owner only, until it expires", async () => {
    const { input } = await setup([4]);
    const [anna, ben] = [await guest("a@x.am"), await guest("b@x.am")];
    const hold = await placeReservationHold(anna, input(), NOW);
    expect(await getLiveGuestHold(db, anna.id, hold.id, NOW)).toMatchObject({ id: hold.id });
    expect(await getLiveGuestHold(db, ben.id, hold.id, NOW)).toBeNull();
    expect(await getLiveGuestHold(db, anna.id, hold.id, hold.expiresAt)).toBeNull();
  });

  it("expires reservations still waiting on an expired hold", async () => {
    const { restaurant, location, tables } = await setup([4]);
    const [waiting] = await db
      .insert(reservations)
      .values({
        restaurantId: restaurant.id,
        locationId: location.id,
        tableId: tables[0]!.id,
        partySize: 2,
        startsAt: local("19:00"),
        endsAt: local("21:00"),
        status: "pending_confirmation",
        contactName: "Anna",
        contactPhone: "+37491000000",
      })
      .returning();
    await db.insert(reservationHolds).values({
      restaurantId: restaurant.id,
      tableId: tables[0]!.id,
      reservationId: waiting!.id,
      startsAt: local("19:00"),
      endsAt: local("21:00"),
      expiresAt: NOW,
    });

    expect((await releaseExpiredHolds(db, NOW)).holdIds).toHaveLength(1);
    const [after] = await db
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, waiting!.id)));
    expect(after).toMatchObject({ status: "expired", expiredAt: NOW });
    expect((await releaseExpiredHolds(db, NOW)).holdIds).toHaveLength(0);
  });
});
