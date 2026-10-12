import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { isExclusionViolation } from "@/server/db/errors";
import { truncate } from "@/test/db";

import { reservationHolds, reservations } from "./reservations";
import { restaurantLocations, restaurants } from "./restaurants";
import { diningTables } from "./tables";

beforeEach(() => truncate(db, ["restaurants"]));

async function location(slug: string, locationSlug = "main") {
  // Reuse the restaurant when adding a second location to it.
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: slug, slug })
    .onConflictDoUpdate({ target: restaurants.slug, set: { name: slug } })
    .returning();
  const [loc] = await db
    .insert(restaurantLocations)
    .values({
      restaurantId: restaurant!.id,
      name: locationSlug,
      slug: locationSlug,
      addressLine: "1 St",
      city: "Yerevan",
    })
    .returning();
  return loc!;
}

async function table(at: { restaurantId: string; id: string }, number = "1") {
  const [row] = await db
    .insert(diningTables)
    .values({ restaurantId: at.restaurantId, locationId: at.id, number })
    .returning();
  return row!;
}

const at = (hour: number, minute = 0) => new Date(Date.UTC(2030, 0, 15, hour, minute));

function hold(t: { id: string; restaurantId: string }, from: Date, to: Date) {
  return { restaurantId: t.restaurantId, tableId: t.id, startsAt: from, endsAt: to };
}

function reservation(t: { id: string; restaurantId: string; locationId: string }) {
  return {
    restaurantId: t.restaurantId,
    locationId: t.locationId,
    tableId: t.id,
    partySize: 2,
    startsAt: at(19),
    endsAt: at(21),
    status: "confirmed" as const,
    contactName: "Anna",
    contactPhone: "+37491000000",
  };
}

describe("location reservation settings", () => {
  it("defaults to staff confirmation, 2-hour slots, 1 hour notice, 30 days ahead", async () => {
    expect(await location("a")).toMatchObject({
      reservationsEnabled: false,
      reservationConfirmation: "manual",
      reservationDurationMinutes: 120,
      reservationMinNoticeMinutes: 60,
      reservationMaxDaysAhead: 30,
    });
  });

  it("rejects out-of-range settings", async () => {
    const loc = await location("a");
    for (const values of [
      { reservationDurationMinutes: 10 },
      { reservationMinNoticeMinutes: -1 },
      { reservationMaxDaysAhead: 0 },
    ]) {
      await expect(
        db.update(restaurantLocations).set(values).where(eq(restaurantLocations.id, loc.id)),
      ).rejects.toThrow();
    }
  });
});

describe("reservations", () => {
  it("stores a booking", async () => {
    const t = await table(await location("a"));
    const [row] = await db.insert(reservations).values(reservation(t)).returning();
    expect(row).toMatchObject({ status: "confirmed", partySize: 2, customerUserId: null });
  });

  it("won't book a table at another location or restaurant", async () => {
    const main = await location("a");
    const terrace = await location("a", "terrace");
    const other = await location("b");
    const t = await table(main);
    await expect(
      db.insert(reservations).values({ ...reservation(t), locationId: terrace.id }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(reservations)
        .values({ ...reservation(t), restaurantId: other.restaurantId, locationId: other.id }),
    ).rejects.toThrow();
  });

  it("rejects bad party sizes, times, phones and blank names", async () => {
    const t = await table(await location("a"));
    for (const bad of [
      { partySize: 0 },
      { partySize: 51 },
      { endsAt: at(19) },
      { contactPhone: "call me" },
      { contactName: "  " },
    ]) {
      await expect(db.insert(reservations).values({ ...reservation(t), ...bad })).rejects.toThrow();
    }
  });
});

describe("reservation holds", () => {
  it("refuses a second live hold on the same table for overlapping times (§49.7)", async () => {
    const t = await table(await location("a"));
    await db.insert(reservationHolds).values(hold(t, at(19), at(21)));
    const overlap = await db
      .insert(reservationHolds)
      .values(hold(t, at(20), at(22)))
      .catch((error: unknown) => error);
    expect(isExclusionViolation(overlap, "reservation_holds_no_overlap")).toBe(true);
    await expect(db.insert(reservationHolds).values(hold(t, at(18), at(19, 30)))).rejects.toThrow();
  });

  it("allows back-to-back holds, other tables, and slots freed by a release", async () => {
    const loc = await location("a");
    const one = await table(loc, "1");
    const two = await table(loc, "2");
    const [first] = await db
      .insert(reservationHolds)
      .values(hold(one, at(19), at(21)))
      .returning();
    await db.insert(reservationHolds).values(hold(one, at(21), at(23))); // starts as the first ends
    await db.insert(reservationHolds).values(hold(two, at(19), at(21)));

    await expect(db.insert(reservationHolds).values(hold(one, at(20), at(21)))).rejects.toThrow();
    await db
      .update(reservationHolds)
      .set({ releasedAt: new Date() })
      .where(eq(reservationHolds.id, first!.id));
    await db.insert(reservationHolds).values(hold(one, at(20), at(21)));
  });

  it("lets only one of two simultaneous holds for the same slot succeed", async () => {
    const t = await table(await location("a"));
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        db.transaction((tx) => tx.insert(reservationHolds).values(hold(t, at(19), at(21)))),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  });

  it("keeps one live hold per reservation", async () => {
    const t = await table(await location("a"));
    const [r] = await db.insert(reservations).values(reservation(t)).returning();
    await db.insert(reservationHolds).values({ ...hold(t, at(19), at(21)), reservationId: r!.id });
    await expect(
      db.insert(reservationHolds).values({ ...hold(t, at(22), at(23)), reservationId: r!.id }),
    ).rejects.toThrow();
  });
});
