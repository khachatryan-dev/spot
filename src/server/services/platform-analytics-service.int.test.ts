import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  analyticsEvents,
  menuCategories,
  menuItems,
  menus,
  orders,
  restaurants,
  tableSessions,
  users,
} from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { guest, orderingSetup, orderRequest } from "@/test/ordering-fixtures";

import { visitorKeyOf } from "../analytics/track";
import { changeOrderStatus, createOrder } from "./order-service";
import { getPlatformStats } from "./platform-analytics-service";
import { resolveQrToken } from "./qr-service";
import { joinTableSession } from "./table-session-service";

beforeEach(() =>
  truncate(db, ["restaurants", "users", "guests", "rate_limits", "analytics_events"]),
);

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

const NOW = new Date("2030-01-18T12:00:00+04:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

async function platform() {
  // Restaurant A (from the fixture): two orders this week, one served.
  const a = await orderingSetup();
  const bob = await guest();
  await joinTableSession(bob, (await resolveQrToken(a.token))!);
  const first = await createOrder(a.ani, a.session.id, orderRequest(a, "platform-order-1"));
  await createOrder(bob, a.session.id, orderRequest(a, "platform-order-2"));
  for (const to of ["accepted", "ready", "served"] as const) {
    await changeOrderStatus(a.owner, a.restaurantId, first.id, to);
  }
  await db
    .update(orders)
    .set({ submittedAt: daysAgo(1) })
    .where(eq(orders.restaurantId, a.restaurantId));
  await db
    .update(tableSessions)
    .set({ createdAt: daysAgo(1) })
    .where(eq(tableSessions.id, a.session.id));
  // Restaurant A was also active last month (a scan by a returning visitor).
  await db.insert(analyticsEvents).values([
    {
      name: "qr_scanned",
      restaurantId: a.restaurantId,
      locationId: a.locationId,
      visitorKey: visitorKeyOf("guest:regular"),
      occurredAt: daysAgo(40),
    },
    {
      name: "qr_scanned",
      restaurantId: a.restaurantId,
      locationId: a.locationId,
      visitorKey: visitorKeyOf("guest:regular"),
      occurredAt: daysAgo(2),
    },
  ]);

  // Restaurant B: active only in the previous period.
  const [b] = await db
    .insert(restaurants)
    .values({ name: "Bistro", slug: "bistro", status: "active" })
    .returning();
  await db
    .insert(analyticsEvents)
    .values({ name: "qr_scanned", restaurantId: b!.id, occurredAt: daysAgo(45) });
  // Restaurant C: a draft with activity — not counted.
  const [c] = await db.insert(restaurants).values({ name: "Draft", slug: "draft" }).returning();
  await db
    .insert(analyticsEvents)
    .values({ name: "qr_scanned", restaurantId: c!.id, occurredAt: daysAgo(1) });
  // Restaurant D: only a menu change this week.
  const [d] = await db
    .insert(restaurants)
    .values({ name: "Deli", slug: "deli", status: "active" })
    .returning();
  const [menu] = await db.insert(menus).values({ restaurantId: d!.id, name: "Main" }).returning();
  const [cat] = await db
    .insert(menuCategories)
    .values({ restaurantId: d!.id, menuId: menu!.id, name: "Food" })
    .returning();
  await db.insert(menuItems).values({
    restaurantId: d!.id,
    categoryId: cat!.id,
    name: "Dolma",
    priceMinor: 100_000,
    updatedAt: daysAgo(3),
    createdAt: daysAgo(3),
  });

  const [admin] = await db
    .insert(users)
    .values({ email: "admin@x.am", platformRole: "platform_admin" })
    .returning();
  return { a, admin: admin! };
}

describe("getPlatformStats", () => {
  it("counts active restaurants by real activity, not sign-ups", async () => {
    const { admin } = await platform();
    const stats = await getPlatformStats(admin, { days: 30 }, NOW);
    expect(stats.active.restaurants).toBe(2); // A and D; B was earlier, C is a draft
    expect(stats.active.tables).toBe(1);
    expect(stats.active.locations).toBe(1);
    expect(stats.totals).toEqual({
      qrScans: 2, // A's recent scan + the draft's (scans are counted as they happened)
      orders: 2,
      completedOrders: 1,
      successRate: 0.5,
      reservations: 0,
      completedReservations: 0,
    });
  });

  it("counts each customer once across scans and orders, and who came back", async () => {
    const { admin } = await platform();
    const stats = await getPlatformStats(admin, { days: 30 }, NOW);
    // Ani and Bob ordered; "regular" scanned. Three different people.
    expect(stats.customers.active).toBe(3);
    expect(stats.customers.monthlyActive).toBe(3);
    expect(stats.customers.returning).toBe(1); // "regular" was seen 40 days ago too
  });

  it("measures restaurant retention against the previous period", async () => {
    const { admin } = await platform();
    const stats = await getPlatformStats(admin, { days: 30 }, NOW);
    // Previous 30 days: A (scan 40 days ago) and B (45 days ago); only A is still active.
    expect(stats.restaurantRetention).toEqual({ previous: 2, retained: 1, rate: 0.5 });
  });

  it("gives daily series and the busiest restaurants; admins only", async () => {
    const { admin, a } = await platform();
    const stats = await getPlatformStats(admin, { days: 7 }, NOW);
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.find((d) => d.date === "2030-01-17")).toMatchObject({ orders: 2 });
    expect(stats.topRestaurants[0]).toMatchObject({ name: "Order Cafe", orders: 2, qrScans: 1 });
    expect((await getPlatformStats(admin, { days: 5 }, NOW)).days).toBe(30);
    expect(await codeOf(getPlatformStats(a.owner, {}, NOW))).toBe("FORBIDDEN");
  });
});
