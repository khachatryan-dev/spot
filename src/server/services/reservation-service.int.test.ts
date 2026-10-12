import { eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  auditLogs,
  reservationHolds,
  reservations,
  restaurantLocations,
  restaurants,
} from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { type RealtimeHint, realtimeChannels } from "@/server/realtime/channels";
import { setRealtimePublisherForTests } from "@/server/realtime/realtime";
import { truncate } from "@/test/db";
import {
  FRIDAY,
  guest,
  local,
  MINUTE,
  NOW,
  reservationSetup,
  staffMember,
} from "@/test/reservation-fixtures";

import { expireOverdueReservations, placeReservationHold } from "./reservation-hold-service";
import {
  cancelMyReservation,
  createReservation,
  listMyReservations,
  listReservationsForStaff,
  updateReservationStatus,
} from "./reservation-service";

const sent: { channel: string; hint: RealtimeHint }[] = [];
setRealtimePublisherForTests({
  publish: async (channel, hint) => void sent.push({ channel, hint }),
});
afterAll(() => setRealtimePublisherForTests(undefined));

beforeEach(async () => {
  await truncate(db, ["restaurants", "users", "rate_limits", "audit_logs"]);
  sent.length = 0;
});

const contact = { contactName: " Anna ", contactPhone: "+374 91 00-00-00", note: "" };

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

const holdOf = async (reservationId: string) =>
  (
    await db
      .select()
      .from(reservationHolds)
      .where(eq(reservationHolds.reservationId, reservationId))
  )[0]!;

describe("createReservation", () => {
  it("waits for staff at a manual-confirmation location; the hold lasts until the start", async () => {
    const { holdInput, tables } = await reservationSetup([4]);
    const anna = await guest("a@x.am");
    const hold = await placeReservationHold(anna, holdInput("19:00", 3), NOW);
    const reservation = await createReservation(anna, { holdId: hold.id, ...contact }, NOW);

    expect(reservation).toMatchObject({
      status: "pending_confirmation",
      confirmedAt: null,
      tableId: tables[0]!.id,
      customerUserId: anna.id,
      partySize: 3,
      startsAt: local("19:00"),
      endsAt: local("21:00"),
      contactName: "Anna",
      contactPhone: "+37491000000",
      note: null,
    });
    expect(await holdOf(reservation.id)).toMatchObject({
      releasedAt: null,
      expiresAt: local("19:00"),
    });
  });

  it("confirms at once at an auto-confirmation location; the hold never expires", async () => {
    const { holdInput } = await reservationSetup([4], { reservationConfirmation: "auto" });
    const anna = await guest("a@x.am");
    const hold = await placeReservationHold(anna, holdInput(), NOW);
    const reservation = await createReservation(anna, { holdId: hold.id, ...contact }, NOW);
    expect(reservation).toMatchObject({ status: "confirmed", confirmedAt: NOW });
    expect((await holdOf(reservation.id)).expiresAt).toBeNull();
  });

  it("records the booking in the audit log", async () => {
    const { holdInput, restaurant } = await reservationSetup([4]);
    const anna = await guest("a@x.am");
    const hold = await placeReservationHold(anna, holdInput(), NOW);
    const reservation = await createReservation(anna, { holdId: hold.id, ...contact }, NOW);
    const [entry] = await db.select().from(auditLogs);
    expect(entry).toMatchObject({
      action: "reservation.created",
      entityType: "reservation",
      entityId: reservation.id,
      restaurantId: restaurant.id,
      actorEmail: "a@x.am",
      metadata: { status: "pending_confirmation", partySize: 2 },
    });
  });

  it("returns the same reservation when the form is submitted twice", async () => {
    const { holdInput } = await reservationSetup([4]);
    const anna = await guest("a@x.am");
    const hold = await placeReservationHold(anna, holdInput(), NOW);
    const [first, second] = await Promise.all([
      createReservation(anna, { holdId: hold.id, ...contact }, NOW),
      createReservation(anna, { holdId: hold.id, ...contact }, NOW),
    ]);
    expect(second.id).toBe(first.id);
    expect(await db.select().from(reservations)).toHaveLength(1);
  });

  it("never books one table twice, even when guests book at the same moment (§49.7)", async () => {
    const { holdInput } = await reservationSetup([4]);
    const people = await Promise.all(["a", "b", "c"].map((n) => guest(`${n}@x.am`)));
    const results = await Promise.all(
      people
        .map(async (person) => {
          const hold = await placeReservationHold(person, holdInput(), NOW);
          return createReservation(person, { holdId: hold.id, ...contact }, NOW);
        })
        .map(codeOf),
    );
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === "RESERVATION_UNAVAILABLE")).toHaveLength(2);
    expect(await db.select().from(reservations)).toHaveLength(1);
  });

  it("refuses an expired, released or someone else's hold", async () => {
    const { holdInput } = await reservationSetup([4, 4]);
    const [anna, ben] = [await guest("a@x.am"), await guest("b@x.am")];
    const hold = await placeReservationHold(anna, holdInput(), NOW);

    expect(await codeOf(createReservation(ben, { holdId: hold.id, ...contact }, NOW))).toBe(
      "RESERVATION_UNAVAILABLE",
    );
    const late = new Date(NOW.getTime() + 10 * MINUTE);
    expect(await codeOf(createReservation(anna, { holdId: hold.id, ...contact }, late))).toBe(
      "RESERVATION_UNAVAILABLE",
    );
    await db
      .update(reservationHolds)
      .set({ releasedAt: NOW })
      .where(eq(reservationHolds.id, hold.id));
    expect(await codeOf(createReservation(anna, { holdId: hold.id, ...contact }, NOW))).toBe(
      "RESERVATION_UNAVAILABLE",
    );
    expect(await db.select().from(reservations)).toHaveLength(0);
  });

  it("won't let a guest hold two tables at overlapping times", async () => {
    const { holdInput } = await reservationSetup([4, 4]);
    const anna = await guest("a@x.am");
    const first = await placeReservationHold(anna, holdInput("19:00"), NOW);
    await createReservation(anna, { holdId: first.id, ...contact }, NOW);

    const overlapping = await placeReservationHold(anna, holdInput("20:00"), NOW);
    expect(await codeOf(createReservation(anna, { holdId: overlapping.id, ...contact }, NOW))).toBe(
      "CONFLICT",
    );

    const later = await placeReservationHold(anna, holdInput("21:00"), NOW);
    await createReservation(anna, { holdId: later.id, ...contact }, NOW);
    expect(await db.select().from(reservations)).toHaveLength(2);
  });

  it("refuses when the location stopped taking reservations", async () => {
    const { holdInput, location } = await reservationSetup([4]);
    const anna = await guest("a@x.am");
    const hold = await placeReservationHold(anna, holdInput(), NOW);
    await db
      .update(restaurantLocations)
      .set({ reservationsEnabled: false })
      .where(eq(restaurantLocations.id, location.id));
    expect(await codeOf(createReservation(anna, { holdId: hold.id, ...contact }, NOW))).toBe(
      "RESERVATION_UNAVAILABLE",
    );
  });

  it("validates contact details", async () => {
    const { holdInput } = await reservationSetup([4]);
    const anna = await guest("a@x.am");
    const hold = await placeReservationHold(anna, holdInput(), NOW);
    for (const bad of [
      { contactName: "  " },
      { contactPhone: "call me" },
      { contactPhone: "12" },
      { note: "x".repeat(501) },
    ]) {
      await expect(
        createReservation(anna, { holdId: hold.id, ...contact, ...bad }, NOW),
      ).rejects.toThrow();
    }
    expect(
      await db.select().from(reservationHolds).where(isNull(reservationHolds.reservationId)),
    ).toHaveLength(1);
  });
});

describe("staff reservation list", () => {
  async function booked() {
    const s = await reservationSetup([2, 4], { reservationConfirmation: "auto" });
    const book = async (email: string, time: string, partySize: number, date?: string) => {
      const person = await guest(email);
      const hold = await placeReservationHold(person, s.holdInput(time, partySize, date), NOW);
      return createReservation(person, { holdId: hold.id, ...contact }, NOW);
    };
    return { ...s, book };
  }

  it("lists a location's bookings for a local day in time order, with table and contact", async () => {
    const { restaurant, location, book } = await booked();
    const owner = await staffMember(restaurant.id, "owner@x.am", "owner");
    await book("b@x.am", "21:00", 4);
    await book("a@x.am", "19:00", 2);
    await book("c@x.am", "23:30", 2);
    // Friday night's opening, but it starts on Saturday: listed under Saturday.
    await book("d@x.am", "00:00", 4, "2030-01-19");

    const friday = await listReservationsForStaff(owner, restaurant.id, location.id, FRIDAY);
    expect(friday.timezone).toBe("Asia/Yerevan");
    expect(
      friday.reservations.map((r) => [r.startsAt, r.tableNumber, r.partySize, r.contactName]),
    ).toEqual([
      [local("19:00"), "1", 2, "Anna"],
      [local("21:00"), "2", 4, "Anna"],
      [local("23:30"), "1", 2, "Anna"],
    ]);
    const saturday = await listReservationsForStaff(
      owner,
      restaurant.id,
      location.id,
      "2030-01-19",
    );
    expect(saturday.reservations.map((r) => r.startsAt)).toEqual([local("00:00", "2030-01-19")]);
  });

  it("is for waiters, managers and owners — not the kitchen or other restaurants", async () => {
    const { restaurant, location, book } = await booked();
    await book("a@x.am", "19:00", 2);
    const waiter = await staffMember(restaurant.id, "w@x.am", "waiter");
    const cook = await staffMember(restaurant.id, "k@x.am", "kitchen");
    const stranger = await guest("s@x.am");
    expect(
      (await listReservationsForStaff(waiter, restaurant.id, location.id, FRIDAY)).reservations,
    ).toHaveLength(1);
    for (const who of [cook, stranger]) {
      await expect(
        listReservationsForStaff(who, restaurant.id, location.id, FRIDAY),
      ).rejects.toBeInstanceOf(AppError);
    }
  });

  it("rejects another restaurant's location and bad dates", async () => {
    const { restaurant, book } = await booked();
    await book("a@x.am", "19:00", 2);
    const owner = await staffMember(restaurant.id, "owner@x.am", "owner");
    expect(
      await codeOf(listReservationsForStaff(owner, restaurant.id, restaurant.id, FRIDAY)),
    ).toBe("NOT_FOUND");
    await expect(
      listReservationsForStaff(owner, restaurant.id, "not-a-uuid", FRIDAY),
    ).rejects.toThrow();
  });

  it("tells the location's staff screens about a new booking, without guest details", async () => {
    const { restaurant, location, book } = await booked();
    const reservation = await book("a@x.am", "19:00", 2);
    expect(sent).toEqual([
      {
        channel: realtimeChannels.location(restaurant.id, location.id),
        hint: { type: "RESERVATION_CREATED", id: reservation.id, status: "confirmed" },
      },
    ]);
  });
});

describe("listMyReservations", () => {
  it("shows a guest only their own bookings, upcoming first then past", async () => {
    const s = await reservationSetup([4, 4]);
    const [anna, ben] = [await guest("a@x.am"), await guest("b@x.am")];
    for (const time of ["21:00", "18:00"]) {
      const hold = await placeReservationHold(anna, s.holdInput(time), NOW);
      await createReservation(anna, { holdId: hold.id, ...contact }, NOW);
    }
    const bens = await placeReservationHold(ben, s.holdInput("19:00"), NOW);
    await createReservation(ben, { holdId: bens.id, ...contact }, NOW);

    const before = await listMyReservations(anna, NOW);
    expect(before.map((r) => r.startsAt)).toEqual([local("18:00"), local("21:00")]);
    expect(before[0]).toMatchObject({ restaurantName: "Cafe", locationName: "Main", partySize: 2 });
    // At 20:30 the 18:00 booking is over: the 21:00 one comes first.
    const during = await listMyReservations(anna, local("20:30"));
    expect(during.map((r) => r.startsAt)).toEqual([local("21:00"), local("18:00")]);
  });
});

describe("reservation status changes", () => {
  async function pending(locationOverrides = {}) {
    const s = await reservationSetup([4], locationOverrides);
    const anna = await guest("anna@x.am");
    const manager = await staffMember(s.restaurant.id, "manager@x.am", "manager");
    const hold = await placeReservationHold(anna, s.holdInput("19:00"), NOW);
    const reservation = await createReservation(anna, { holdId: hold.id, ...contact }, NOW);
    const act = (
      who: { id: string },
      action: Parameters<typeof updateReservationStatus>[3],
      options: { reason?: string; now?: Date } = {},
    ) =>
      updateReservationStatus(
        who,
        s.restaurant.id,
        reservation.id,
        action,
        { reason: options.reason },
        options.now ?? NOW,
      );
    /** Can someone else book this table at 19:00 now? */
    const slotFree = async (now = NOW) =>
      (await codeOf(
        placeReservationHold(await guest(`x${Date.now()}@x.am`), s.holdInput("19:00"), now),
      )) === null;
    return { ...s, anna, manager, reservation, act, slotFree };
  }

  it("confirms a request; the table is then held until released", async () => {
    const { manager, reservation, act } = await pending();
    const confirmed = await act(manager, "confirm");
    expect(confirmed).toMatchObject({ status: "confirmed", confirmedAt: NOW });
    expect((await holdOf(reservation.id)).expiresAt).toBeNull();
    const [entry] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "reservation.confirmed"));
    expect(entry).toMatchObject({
      entityId: reservation.id,
      actorEmail: "manager@x.am",
      metadata: { from: "pending_confirmation", to: "confirmed" },
    });
    expect(sent.at(-1)?.hint).toEqual({
      type: "RESERVATION_STATUS_CHANGED",
      id: reservation.id,
      status: "confirmed",
    });
  });

  it("declines with a reason the guest sees, and frees the table", async () => {
    const { manager, act, slotFree, anna } = await pending();
    expect(await codeOf(act(manager, "decline"))).toContain("reasonTooShort");
    expect(await slotFree()).toBe(false);
    const declined = await act(manager, "decline", { reason: "Fully booked for an event" });
    expect(declined).toMatchObject({
      status: "cancelled",
      cancelledByUserId: manager.id,
      cancellationReason: "Fully booked for an event",
    });
    expect((await listMyReservations(anna, NOW))[0]).toMatchObject({
      status: "cancelled",
      cancellationReason: "Fully booked for an event",
    });
    expect(await slotFree()).toBe(true);
  });

  it("walks arrival, seating and completion; completing frees the rest of the slot", async () => {
    const { manager, act, slotFree } = await pending({ reservationConfirmation: "auto" });
    const atStart = local("19:00");
    expect(await act(manager, "arrive", { now: atStart })).toMatchObject({
      status: "arrived",
      arrivedAt: atStart,
    });
    const seatedAt = local("19:05");
    expect(await act(manager, "seat", { now: seatedAt })).toMatchObject({
      status: "seated",
      seatedAt,
      arrivedAt: atStart,
    });
    expect(await codeOf(act(manager, "arrive", { now: seatedAt }))).toBe("CONFLICT");
    expect(await act(manager, "complete", { now: local("20:00") })).toMatchObject({
      status: "completed",
    });
    expect(await slotFree()).toBe(true);
  });

  it("marks no-shows only after the start time", async () => {
    const { manager, act, slotFree } = await pending({ reservationConfirmation: "auto" });
    expect(await codeOf(act(manager, "no_show", { now: local("18:59") }))).toBe("CONFLICT");
    expect(await act(manager, "no_show", { now: local("19:20") })).toMatchObject({
      status: "no_show",
      noShowAt: local("19:20"),
    });
    expect(await slotFree()).toBe(true);
  });

  it("lets waiters seat guests but not confirm or cancel; the kitchen does neither", async () => {
    const { restaurant, act } = await pending();
    const waiter = await staffMember(restaurant.id, "w@x.am", "waiter");
    const cook = await staffMember(restaurant.id, "k@x.am", "kitchen");
    expect(await codeOf(act(waiter, "confirm"))).toBe("FORBIDDEN");
    expect(await codeOf(act(cook, "seat"))).toBe("FORBIDDEN");
    const manager = await staffMember(restaurant.id, "m2@x.am", "manager");
    await act(manager, "confirm");
    expect(await act(waiter, "seat")).toMatchObject({ status: "seated" });
    expect(await codeOf(act(waiter, "cancel", { reason: "No reason" }))).toBe("FORBIDDEN");
  });

  it("keeps other restaurants out", async () => {
    const { reservation } = await pending();
    const other = await db
      .insert(restaurants)
      .values({ name: "Other", slug: "other", status: "active" })
      .returning();
    const theirOwner = await staffMember(other[0]!.id, "o@x.am", "owner");
    expect(
      await codeOf(updateReservationStatus(theirOwner, other[0]!.id, reservation.id, "confirm")),
    ).toBe("NOT_FOUND");
  });

  it("can't confirm a request that ran out at its start time", async () => {
    const { manager, reservation, act } = await pending();
    expect(await codeOf(act(manager, "confirm", { now: local("19:00") }))).toBe(
      "RESERVATION_UNAVAILABLE",
    );
    const [after] = await db.select().from(reservations).where(eq(reservations.id, reservation.id));
    expect(after).toMatchObject({ status: "expired" });
  });

  it("lets only one of two simultaneous answers win", async () => {
    const { manager, act } = await pending();
    const results = await Promise.all([
      codeOf(act(manager, "confirm")),
      codeOf(act(manager, "decline", { reason: "Kitchen closed" })),
    ]);
    expect(results.sort()).toEqual(["CONFLICT", null].sort());
  });

  it("lets guests cancel their own booking before it starts", async () => {
    const { anna, reservation, slotFree } = await pending();
    const ben = await guest("ben@x.am");
    expect(await codeOf(cancelMyReservation(ben, reservation.id, NOW))).toBe("NOT_FOUND");
    expect(await cancelMyReservation(anna, reservation.id, NOW)).toMatchObject({
      status: "cancelled",
      cancelledByUserId: anna.id,
      cancellationReason: null,
    });
    expect(await slotFree()).toBe(true);
    expect(await codeOf(cancelMyReservation(anna, reservation.id, NOW))).toBe("CONFLICT");
  });

  it("stops guests cancelling online once the booking has started", async () => {
    const { anna, reservation } = await pending({ reservationConfirmation: "auto" });
    expect(await codeOf(cancelMyReservation(anna, reservation.id, local("19:00")))).toBe(
      "CONFLICT",
    );
  });
});

describe("expiring unanswered requests", () => {
  it("shows staff and guests 'expired' once a request's start passes, and notifies screens", async () => {
    const s = await reservationSetup([4]);
    const anna = await guest("anna@x.am");
    const owner = await staffMember(s.restaurant.id, "owner@x.am", "owner");
    const hold = await placeReservationHold(anna, s.holdInput("19:00"), NOW);
    const reservation = await createReservation(anna, { holdId: hold.id, ...contact }, NOW);
    sent.length = 0;

    const before = await listReservationsForStaff(
      owner,
      s.restaurant.id,
      s.location.id,
      FRIDAY,
      NOW,
    );
    expect(before.reservations[0]!.status).toBe("pending_confirmation");
    expect(sent).toEqual([]);

    const later = local("19:00");
    const after = await listReservationsForStaff(
      owner,
      s.restaurant.id,
      s.location.id,
      FRIDAY,
      later,
    );
    expect(after.reservations[0]!.status).toBe("expired");
    expect(sent.map((m) => m.hint)).toEqual([
      { type: "RESERVATION_STATUS_CHANGED", id: reservation.id, status: "expired" },
    ]);
    expect((await listMyReservations(anna, later))[0]!.status).toBe("expired");
  });

  it("limits the sweep to the given location or guest; the job sweeps everything", async () => {
    const a = await reservationSetup([4]);
    const ben = await guest("ben@x.am");
    const anna = await guest("anna@x.am");
    const annaHold = await placeReservationHold(anna, a.holdInput("19:00"), NOW);
    await createReservation(anna, { holdId: annaHold.id, ...contact }, NOW);
    const benHold = await placeReservationHold(ben, a.holdInput("21:00"), NOW);
    await createReservation(ben, { holdId: benHold.id, ...contact }, NOW);
    const late = local("23:00");

    expect(
      (await expireOverdueReservations({ customerUserId: anna.id }, late)).expired,
    ).toHaveLength(1);
    const otherPlace = await db
      .insert(restaurantLocations)
      .values({
        restaurantId: a.restaurant.id,
        name: "Other",
        slug: "other",
        addressLine: "2 St",
        city: "Yerevan",
      })
      .returning();
    expect(
      (await expireOverdueReservations({ locationId: otherPlace[0]!.id }, late)).expired,
    ).toHaveLength(0);
    expect((await expireOverdueReservations(undefined, late)).expired).toHaveLength(1);
    expect((await expireOverdueReservations(undefined, late)).expired).toHaveLength(0);
    const statuses = (await db.select().from(reservations)).map((r) => r.status);
    expect(statuses).toEqual(["expired", "expired"]);
  });
});
