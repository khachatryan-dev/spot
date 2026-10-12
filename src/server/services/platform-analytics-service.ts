import "server-only";

import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";

import { visitorKeyOf } from "@/server/analytics/track";
import type { SessionUser } from "@/server/auth/session";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "@/server/db/client";
import {
  analyticsEvents,
  diningTables,
  menuItems,
  orders,
  reservations,
  restaurants,
  reviews,
  tableSessionMembers,
  tableSessions,
} from "@/server/db/schema";
import { authorizePlatform } from "@/server/policies/restaurant-access";
import { addDays, localDate, zonedTime } from "@/shared/domain/reservation-slots";

/*
 * Platform-wide year-one metrics (§4.2) for admins (platform:analytics:read).
 * "Active" means meaningful activity in the period, not sign-ups: a
 * restaurant is active with a QR scan, order, reservation, menu change or
 * review. Customers are counted through the same anonymous visitor keys as
 * analytics events, so a guest who scans, orders and books counts once.
 */

type Admin = Pick<SessionUser, "platformRole">;
export const PLATFORM_RANGES = [7, 30, 90] as const;
export type PlatformRange = (typeof PLATFORM_RANGES)[number];
/** Platform days are counted in Armenian time. */
const TIMEZONE = "Asia/Yerevan";

/** Raw SQL fragments take timestamps as ISO strings (only typed columns convert Dates). */
const iso = (date: Date) => date.toISOString();

interface Period {
  from: Date;
  to: Date;
}

/** Restaurants (approved) with meaningful activity in a period. */
async function activeRestaurantIds({ from, to }: Period): Promise<Set<string>> {
  const inPeriod = (column: AnyPgColumn) => and(gte(column, from), lt(column, to));
  const lists = await Promise.all([
    db
      .selectDistinct({ id: analyticsEvents.restaurantId })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.name, "qr_scanned"), inPeriod(analyticsEvents.occurredAt))),
    db.selectDistinct({ id: orders.restaurantId }).from(orders).where(inPeriod(orders.submittedAt)),
    db
      .selectDistinct({ id: reservations.restaurantId })
      .from(reservations)
      .where(inPeriod(reservations.createdAt)),
    db
      .selectDistinct({ id: menuItems.restaurantId })
      .from(menuItems)
      .where(inPeriod(menuItems.updatedAt)),
    db
      .selectDistinct({ id: reviews.restaurantId })
      .from(reviews)
      .where(inPeriod(reviews.createdAt)),
  ]);
  const ids = new Set(lists.flat().flatMap((r) => (r.id ? [r.id] : [])));
  if (ids.size === 0) return ids;
  const approved = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(and(inArray(restaurants.id, [...ids]), eq(restaurants.status, "active")));
  return new Set(approved.map((r) => r.id));
}

/** Anonymous keys of customers active in a period (scans, views, orders, bookings). */
async function activeCustomerKeys({ from, to }: Period): Promise<Set<string>> {
  const [events, orderPeople, bookers] = await Promise.all([
    db
      .selectDistinct({ key: analyticsEvents.visitorKey })
      .from(analyticsEvents)
      .where(
        and(
          isNotNull(analyticsEvents.visitorKey),
          gte(analyticsEvents.occurredAt, from),
          lt(analyticsEvents.occurredAt, to),
        ),
      ),
    db
      .selectDistinct({ userId: tableSessionMembers.userId, guestId: tableSessionMembers.guestId })
      .from(orders)
      .innerJoin(tableSessionMembers, eq(tableSessionMembers.id, orders.memberId))
      .where(and(gte(orders.submittedAt, from), lt(orders.submittedAt, to))),
    db
      .selectDistinct({ userId: reservations.customerUserId })
      .from(reservations)
      .where(
        and(
          isNotNull(reservations.customerUserId),
          gte(reservations.createdAt, from),
          lt(reservations.createdAt, to),
        ),
      ),
  ]);
  const keys = new Set(events.map((e) => e.key!));
  for (const p of orderPeople) {
    if (p.userId) keys.add(visitorKeyOf(`user:${p.userId}`));
    else if (p.guestId) keys.add(visitorKeyOf(`guest:${p.guestId}`));
  }
  for (const b of bookers) keys.add(visitorKeyOf(`user:${b.userId}`));
  return keys;
}

export interface PlatformStats {
  days: PlatformRange;
  active: { restaurants: number; locations: number; tables: number };
  totals: {
    qrScans: number;
    orders: number;
    completedOrders: number;
    successRate: number | null;
    reservations: number;
    completedReservations: number;
  };
  customers: { active: number; monthlyActive: number; returning: number };
  /** Of restaurants active in the previous period, the share still active now. */
  restaurantRetention: { previous: number; retained: number; rate: number | null };
  daily: { date: string; orders: number; qrScans: number; reservations: number }[];
  topRestaurants: {
    id: string;
    name: string;
    orders: number;
    reservations: number;
    qrScans: number;
  }[];
}

export async function getPlatformStats(
  admin: Admin,
  options: { days?: number } = {},
  now = new Date(),
): Promise<PlatformStats> {
  authorizePlatform(admin, "platform:analytics:read");
  const days: PlatformRange = (PLATFORM_RANGES as readonly number[]).includes(options.days ?? 0)
    ? (options.days as PlatformRange)
    : 30;
  const today = localDate(now, TIMEZONE);
  const firstDay = addDays(today, -(days - 1));
  const current: Period = {
    from: zonedTime(firstDay, 0, TIMEZONE),
    to: zonedTime(addDays(today, 1), 0, TIMEZONE),
  };
  const previous: Period = {
    from: zonedTime(addDays(firstDay, -days), 0, TIMEZONE),
    to: current.from,
  };
  const month: Period = { from: new Date(now.getTime() - 30 * 86_400_000), to: current.to };

  const inCurrent = (column: AnyPgColumn) => and(gte(column, current.from), lt(column, current.to));
  const localDay = (column: AnyPgColumn) =>
    sql<string>`to_char(${column} AT TIME ZONE ${TIMEZONE}, 'YYYY-MM-DD')`;

  const [
    activeNow,
    activeBefore,
    [locationsRow],
    [tablesRow],
    [orderRow],
    [reservationRow],
    [scanRow],
    customersNow,
    customersMonth,
    [returningRow],
    dailyOrders,
    dailyScans,
    dailyReservations,
  ] = await Promise.all([
    activeRestaurantIds(current),
    activeRestaurantIds(previous),
    db
      .select({
        count: sql<number>`count(DISTINCT x.location_id)::int`,
      })
      .from(
        sql`(SELECT location_id FROM orders WHERE submitted_at >= ${iso(current.from)} AND submitted_at < ${iso(current.to)}
             UNION SELECT location_id FROM reservations WHERE created_at >= ${iso(current.from)} AND created_at < ${iso(current.to)}
             UNION SELECT location_id FROM analytics_events WHERE name = 'qr_scanned' AND location_id IS NOT NULL
               AND occurred_at >= ${iso(current.from)} AND occurred_at < ${iso(current.to)}) AS x`,
      ),
    db
      .select({ count: sql<number>`count(DISTINCT ${tableSessions.tableId})::int` })
      .from(tableSessions)
      .innerJoin(diningTables, eq(diningTables.id, tableSessions.tableId))
      .where(inCurrent(tableSessions.createdAt)),
    db
      .select({
        orders: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) FILTER (WHERE ${orders.status} IN ('served', 'completed'))::int`,
      })
      .from(orders)
      .where(inCurrent(orders.submittedAt)),
    db
      .select({
        reservations: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) FILTER (WHERE ${reservations.status} = 'completed')::int`,
      })
      .from(reservations)
      .where(inCurrent(reservations.createdAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.name, "qr_scanned"), inCurrent(analyticsEvents.occurredAt))),
    activeCustomerKeys(current),
    activeCustomerKeys(month),
    db.select({ count: sql<number>`count(*)::int` }).from(
      sql`(SELECT visitor_key FROM analytics_events WHERE visitor_key IS NOT NULL
             GROUP BY visitor_key
             HAVING min(occurred_at) < ${iso(current.from)} AND max(occurred_at) >= ${iso(current.from)}) AS r`,
    ),
    db
      .select({ date: localDay(orders.submittedAt), count: sql<number>`count(*)::int` })
      .from(orders)
      .where(inCurrent(orders.submittedAt))
      .groupBy(sql`1`),
    db
      .select({ date: localDay(analyticsEvents.occurredAt), count: sql<number>`count(*)::int` })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.name, "qr_scanned"), inCurrent(analyticsEvents.occurredAt)))
      .groupBy(sql`1`),
    db
      .select({ date: localDay(reservations.createdAt), count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(inCurrent(reservations.createdAt))
      .groupBy(sql`1`),
  ]);

  const retained = [...activeBefore].filter((id) => activeNow.has(id)).length;
  const top = await topRestaurants(current, [...activeNow]);
  const count = (rows: { date: string; count: number }[], date: string) =>
    rows.find((r) => r.date === date)?.count ?? 0;

  return {
    days,
    active: {
      restaurants: activeNow.size,
      locations: locationsRow!.count,
      tables: tablesRow!.count,
    },
    totals: {
      qrScans: scanRow!.count,
      orders: orderRow!.orders,
      completedOrders: orderRow!.completed,
      successRate: orderRow!.orders > 0 ? orderRow!.completed / orderRow!.orders : null,
      reservations: reservationRow!.reservations,
      completedReservations: reservationRow!.completed,
    },
    customers: {
      active: customersNow.size,
      monthlyActive: customersMonth.size,
      returning: returningRow!.count,
    },
    restaurantRetention: {
      previous: activeBefore.size,
      retained,
      rate: activeBefore.size > 0 ? retained / activeBefore.size : null,
    },
    daily: Array.from({ length: days }, (_, i) => {
      const date = addDays(firstDay, i);
      return {
        date,
        orders: count(dailyOrders, date),
        qrScans: count(dailyScans, date),
        reservations: count(dailyReservations, date),
      };
    }),
    topRestaurants: top,
  };
}

/** The busiest active restaurants of the period. */
async function topRestaurants(period: Period, ids: string[]) {
  if (ids.length === 0) return [];
  const from = iso(period.from);
  const to = iso(period.to);
  const rows = await db.execute<{
    id: string;
    name: string;
    orders: number;
    reservations: number;
    qr_scans: number;
  }>(sql`
    SELECT r.id, r.name,
      (SELECT count(*)::int FROM orders o WHERE o.restaurant_id = r.id AND o.submitted_at >= ${from} AND o.submitted_at < ${to}) AS orders,
      (SELECT count(*)::int FROM reservations b WHERE b.restaurant_id = r.id AND b.created_at >= ${from} AND b.created_at < ${to}) AS reservations,
      (SELECT count(*)::int FROM analytics_events e WHERE e.restaurant_id = r.id AND e.name = 'qr_scanned'
         AND e.occurred_at >= ${from} AND e.occurred_at < ${to}) AS qr_scans
    FROM restaurants r
    WHERE r.id IN ${ids}
    ORDER BY orders DESC, reservations DESC, qr_scans DESC, r.name
    LIMIT 10`);
  return [...rows].map((r) => ({
    id: r.id,
    name: r.name,
    orders: r.orders,
    reservations: r.reservations,
    qrScans: r.qr_scans,
  }));
}
