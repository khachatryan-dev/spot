import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  analyticsEvents,
  orders,
  reservations,
  restaurantStaff,
  reviews,
  tableSessions,
  users,
} from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { orderingSetup, orderRequest } from "@/test/ordering-fixtures";

import { visitorKeyOf } from "../analytics/track";
import { changeOrderStatus, createOrder } from "./order-service";
import { getRestaurantStats } from "./restaurant-analytics-service";

beforeEach(() =>
  truncate(db, ["restaurants", "users", "guests", "rate_limits", "analytics_events"]),
);

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

/** Yerevan noon on a given day offset from "now" (2030-01-18 12:00). */
const NOW = new Date("2030-01-18T12:00:00+04:00");
const daysAgo = (n: number, hour = 12) =>
  new Date(NOW.getTime() - n * 86_400_000 + (hour - 12) * 3_600_000);

async function busyRestaurant() {
  const s = await orderingSetup();
  // Orders: two served (1 000 000 each), one cancelled, one rejected.
  const placed = [];
  for (let i = 0; i < 4; i++) {
    placed.push(await createOrder(s.ani, s.session.id, orderRequest(s, `stats-order-${i}`)));
  }
  for (const order of placed.slice(0, 2)) {
    for (const to of ["accepted", "ready", "served"] as const) {
      await changeOrderStatus(s.owner, s.restaurantId, order.id, to);
    }
  }
  await changeOrderStatus(s.owner, s.restaurantId, placed[2]!.id, "cancelled", {
    reason: "Changed mind",
  });
  await changeOrderStatus(s.owner, s.restaurantId, placed[3]!.id, "rejected", {
    reason: "Out of stock",
  });
  // Spread them over days: two yesterday at 20:00 local, two today at 13:00.
  await db
    .update(orders)
    .set({ submittedAt: daysAgo(1, 20) })
    .where(eq(orders.id, placed[0]!.id));
  await db
    .update(orders)
    .set({ submittedAt: daysAgo(1, 20) })
    .where(eq(orders.id, placed[2]!.id));
  await db
    .update(orders)
    .set({ submittedAt: daysAgo(0, 13) })
    .where(eq(orders.id, placed[1]!.id));
  await db
    .update(orders)
    .set({ submittedAt: daysAgo(0, 13) })
    .where(eq(orders.id, placed[3]!.id));
  await db
    .update(tableSessions)
    .set({ createdAt: daysAgo(1, 19) })
    .where(eq(tableSessions.id, s.session.id));
  // An old order outside every range.
  const old = await createOrder(s.ani, s.session.id, orderRequest(s, "stats-order-old"));
  await db
    .update(orders)
    .set({ submittedAt: daysAgo(200) })
    .where(eq(orders.id, old.id));

  // QR scans: visitor A today and 3 days ago (returning), visitor B today only, C long ago.
  const scan = (visitor: string, at: Date) =>
    db.insert(analyticsEvents).values({
      name: "qr_scanned",
      restaurantId: s.restaurantId,
      locationId: s.locationId,
      visitorKey: visitorKeyOf(visitor),
      occurredAt: at,
    });
  await scan("guest:a", daysAgo(0));
  await scan("guest:a", daysAgo(3));
  await scan("guest:b", daysAgo(0));
  await scan("guest:c", daysAgo(100));
  await db.insert(analyticsEvents).values([
    { name: "restaurant_viewed", restaurantId: s.restaurantId, occurredAt: daysAgo(2) },
    {
      name: "booking_page_viewed",
      restaurantId: s.restaurantId,
      locationId: s.locationId,
      occurredAt: daysAgo(2),
    },
  ]);

  // Reservations: one completed, one no-show (made 2 days ago).
  for (const status of ["completed", "no_show"] as const) {
    await db.insert(reservations).values({
      restaurantId: s.restaurantId,
      locationId: s.locationId,
      tableId: s.table.id,
      partySize: 2,
      startsAt: daysAgo(2, 19),
      endsAt: daysAgo(2, 21),
      status,
      contactName: "Anna",
      contactPhone: "+37491000000",
      createdAt: daysAgo(2),
    });
  }
  // A review (4 stars).
  await db.insert(reviews).values({
    restaurantId: s.restaurantId,
    locationId: s.locationId,
    subject: "visit",
    tableSessionId: s.session.id,
    authorGuestId: null,
    displayName: "Guest",
    rating: 4,
    status: "published",
    publishedAt: daysAgo(1),
    createdAt: daysAgo(1),
  });
  return s;
}

describe("getRestaurantStats", () => {
  it("adds up guests, orders, reservations and reviews for the period", async () => {
    const s = await busyRestaurant();
    const stats = await getRestaurantStats(s.owner, s.restaurantId, { days: 7 }, NOW);
    expect(stats.guests).toEqual({
      qrScans: 3,
      visits: 1,
      pageViews: 1,
      bookingViews: 1,
      visitors: 2,
      returning: 1,
    });
    expect(stats.orders).toEqual({
      placed: 4,
      completed: 2,
      cancelled: 1,
      rejected: 1,
      successRate: 0.5,
      revenueMinor: 2_000_000,
      averageMinor: 1_000_000,
    });
    expect(stats.reservations).toEqual({
      made: 2,
      completed: 1,
      noShows: 1,
      cancelled: 0,
      expired: 0,
    });
    expect(stats.reviews).toEqual({ count: 1, average: 4 });
    expect(stats.currency).toBe("AMD");
  });

  it("splits days and hours in the location's time zone", async () => {
    const s = await busyRestaurant();
    const stats = await getRestaurantStats(s.owner, s.restaurantId, { days: 7 }, NOW);
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.at(-1)).toEqual({
      date: "2030-01-18",
      orders: 2,
      revenueMinor: 1_000_000,
      reservations: 0,
    });
    expect(stats.daily.at(-2)).toEqual({
      date: "2030-01-17",
      orders: 2,
      revenueMinor: 1_000_000,
      reservations: 0,
    });
    expect(stats.daily.at(-3)).toMatchObject({ date: "2030-01-16", reservations: 2 });
    expect(stats.hours.find((h) => h.hour === 20)!.orders).toBe(2);
    expect(stats.hours.find((h) => h.hour === 13)!.orders).toBe(2);
    expect(stats.topItems).toEqual([
      { name: "Pizza", quantity: 4, revenueMinor: 1_600_000 },
      { name: "Soup", quantity: 2, revenueMinor: 400_000 },
    ]);
  });

  it("narrows to the chosen range and location", async () => {
    const s = await busyRestaurant();
    const oneDay = await getRestaurantStats(s.owner, s.restaurantId, { days: 90 }, NOW);
    expect(oneDay.daily).toHaveLength(90);
    expect(oneDay.orders.placed).toBe(4); // the 200-day-old order is outside
    const weird = await getRestaurantStats(s.owner, s.restaurantId, { days: 13 }, NOW);
    expect(weird.days).toBe(30);
    const here = await getRestaurantStats(
      s.owner,
      s.restaurantId,
      { days: 7, locationId: s.locationId },
      NOW,
    );
    expect(here.orders.placed).toBe(4);
    expect(
      await codeOf(
        getRestaurantStats(s.owner, s.restaurantId, { locationId: s.restaurantId }, NOW),
      ),
    ).toBe("NOT_FOUND");
  });

  it("is for owners and managers, not waiters", async () => {
    const s = await busyRestaurant();
    const [waiter] = await db.insert(users).values({ email: "w@x.am" }).returning();
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: s.restaurantId, userId: waiter!.id, role: "waiter" });
    expect(await codeOf(getRestaurantStats(waiter!, s.restaurantId, {}, NOW))).toBe("FORBIDDEN");
  });
});
