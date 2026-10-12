import "server-only";

import { and, eq, gte, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import {
  analyticsEvents,
  diningTables,
  orderItems,
  orders,
  reservations,
  restaurantLocations,
  restaurants,
  reviews,
  tableSessions,
} from "@/server/db/schema";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { addDays, localDate } from "@/shared/domain/reservation-slots";
import { AppError } from "@/shared/errors";

/*
 * A restaurant's own numbers (§4.2) for the last 7, 30 or 90 days, for
 * owners and managers (analytics:read). Days and hours are in the
 * location's time zone. Nothing here identifies a guest.
 */

type Actor = Pick<SessionUser, "id">;
export const STATS_RANGES = [7, 30, 90] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

const SERVED = ["served", "completed"] as const;

export interface RestaurantStats {
  days: StatsRange;
  timezone: string;
  currency: string;
  guests: {
    qrScans: number;
    visits: number;
    pageViews: number;
    bookingViews: number;
    visitors: number;
    returning: number;
  };
  orders: {
    placed: number;
    completed: number;
    cancelled: number;
    rejected: number;
    successRate: number | null;
    revenueMinor: number;
    averageMinor: number | null;
  };
  reservations: {
    made: number;
    completed: number;
    noShows: number;
    cancelled: number;
    expired: number;
  };
  reviews: { count: number; average: number | null };
  daily: { date: string; orders: number; revenueMinor: number; reservations: number }[];
  topItems: { name: string; quantity: number; revenueMinor: number }[];
  hours: { hour: number; orders: number }[];
}

export async function getRestaurantStats(
  actor: Actor,
  restaurantId: string,
  options: { days?: number; locationId?: string },
  now = new Date(),
): Promise<RestaurantStats> {
  await authorizeRestaurant(actor.id, restaurantId, "analytics:read");
  const days: StatsRange = (STATS_RANGES as readonly number[]).includes(options.days ?? 0)
    ? (options.days as StatsRange)
    : 30;
  const locationId = z.uuid().safeParse(options.locationId).success
    ? options.locationId
    : undefined;

  const [restaurant] = await db
    .select({ currency: restaurants.currency })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId));
  const locations = await db
    .select({ id: restaurantLocations.id, timezone: restaurantLocations.timezone })
    .from(restaurantLocations)
    .where(eq(restaurantLocations.restaurantId, restaurantId));
  if (!restaurant) throw new AppError("NOT_FOUND", "Restaurant not found.");
  if (locationId && !locations.some((l) => l.id === locationId)) {
    throw new AppError("NOT_FOUND", "Location not found.");
  }
  const timezone =
    locations.find((l) => l.id === locationId)?.timezone ??
    locations[0]?.timezone ??
    "Asia/Yerevan";

  // The last `days` local calendar days, today included.
  const today = localDate(now, timezone);
  const firstDay = addDays(today, -(days - 1));
  const since = sql`(${firstDay}::date::timestamp AT TIME ZONE ${timezone})`;
  const localDay = (column: SQL | typeof orders.submittedAt) =>
    sql<string>`to_char(${column} AT TIME ZONE ${timezone}, 'YYYY-MM-DD')`;

  const atLocation = <T extends { locationId: unknown }>(table: T) =>
    locationId ? eq(table.locationId as never, locationId) : undefined;

  const eventCounts = db
    .select({
      name: analyticsEvents.name,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.restaurantId, restaurantId),
        gte(analyticsEvents.occurredAt, since),
        locationId
          ? sql`(${analyticsEvents.locationId} = ${locationId} OR ${analyticsEvents.name} = 'restaurant_viewed')`
          : undefined,
      ),
    )
    .groupBy(analyticsEvents.name);

  // Visitors who scanned in the period; "returning" were seen before it or on 2+ days.
  const visitorRows = db
    .select({
      returning: sql<number>`count(*) FILTER (WHERE first_seen < ${since} OR scan_days >= 2)::int`,
      visitors: sql<number>`count(*)::int`,
    })
    .from(
      sql`(SELECT ae.visitor_key,
                  min(ae.occurred_at) AS first_seen,
                  count(DISTINCT (ae.occurred_at AT TIME ZONE ${timezone})::date)
                    FILTER (WHERE ae.occurred_at >= ${since}) AS scan_days
           FROM analytics_events ae
           WHERE ae.restaurant_id = ${restaurantId} AND ae.name = 'qr_scanned'
             AND ae.visitor_key IS NOT NULL
             ${locationId ? sql`AND ae.location_id = ${locationId}` : sql``}
           GROUP BY ae.visitor_key
           HAVING max(ae.occurred_at) >= ${since}) AS v`,
    );

  const visits = db
    .select({ count: sql<number>`count(*)::int` })
    .from(tableSessions)
    .innerJoin(diningTables, eq(diningTables.id, tableSessions.tableId))
    .where(
      and(
        eq(tableSessions.restaurantId, restaurantId),
        gte(tableSessions.createdAt, since),
        locationId ? eq(diningTables.locationId, locationId) : undefined,
      ),
    );

  const orderWhere = and(
    eq(orders.restaurantId, restaurantId),
    gte(orders.submittedAt, since),
    atLocation(orders),
  );
  const servedOrder = sql`${orders.status} IN ('served', 'completed')`;
  const orderTotals = db
    .select({
      placed: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) FILTER (WHERE ${servedOrder})::int`,
      cancelled: sql<number>`count(*) FILTER (WHERE ${orders.status} = 'cancelled')::int`,
      rejected: sql<number>`count(*) FILTER (WHERE ${orders.status} = 'rejected')::int`,
      revenueMinor: sql<number>`coalesce(sum(${orders.totalMinor}) FILTER (WHERE ${servedOrder}), 0)::int`,
    })
    .from(orders)
    .where(orderWhere);

  const reservationTotals = db
    .select({
      made: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) FILTER (WHERE ${reservations.status} = 'completed')::int`,
      noShows: sql<number>`count(*) FILTER (WHERE ${reservations.status} = 'no_show')::int`,
      cancelled: sql<number>`count(*) FILTER (WHERE ${reservations.status} = 'cancelled')::int`,
      expired: sql<number>`count(*) FILTER (WHERE ${reservations.status} = 'expired')::int`,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.restaurantId, restaurantId),
        gte(reservations.createdAt, since),
        atLocation(reservations),
      ),
    );

  const reviewTotals = db
    .select({
      count: sql<number>`count(*)::int`,
      average: sql<number | null>`round(avg(${reviews.rating}), 1)::float`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        eq(reviews.status, "published"),
        gte(reviews.createdAt, since),
        atLocation(reviews),
      ),
    );

  const dailyOrders = db
    .select({
      date: localDay(orders.submittedAt),
      orders: sql<number>`count(*)::int`,
      revenueMinor: sql<number>`coalesce(sum(${orders.totalMinor}) FILTER (WHERE ${servedOrder}), 0)::int`,
    })
    .from(orders)
    .where(orderWhere)
    .groupBy(sql`1`);
  const dailyReservations = db
    .select({ date: localDay(sql`${reservations.createdAt}`), count: sql<number>`count(*)::int` })
    .from(reservations)
    .where(
      and(
        eq(reservations.restaurantId, restaurantId),
        gte(reservations.createdAt, since),
        atLocation(reservations),
      ),
    )
    .groupBy(sql`1`);

  const topItems = db
    .select({
      name: orderItems.name,
      quantity: sql<number>`sum(${orderItems.quantity})::int`,
      revenueMinor: sql<number>`sum(${orderItems.lineTotalMinor})::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(orderWhere, inArray(orders.status, [...SERVED])))
    .groupBy(orderItems.name)
    .orderBy(sql`2 DESC`, orderItems.name)
    .limit(5);

  const hours = db
    .select({
      hour: sql<number>`extract(hour FROM ${orders.submittedAt} AT TIME ZONE ${timezone})::int`,
      orders: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(orderWhere)
    .groupBy(sql`1`);

  const [
    events,
    [visitorsRow],
    [visitsRow],
    [ordersRow],
    [reservationsRow],
    [reviewsRow],
    daily,
    dailyRes,
    top,
    byHour,
  ] = await Promise.all([
    eventCounts,
    visitorRows,
    visits,
    orderTotals,
    reservationTotals,
    reviewTotals,
    dailyOrders,
    dailyReservations,
    topItems,
    hours,
  ]);
  const eventCount = (name: string) => events.find((e) => e.name === name)?.count ?? 0;
  const o = ordersRow!;
  const dates = Array.from({ length: days }, (_, i) => addDays(firstDay, i));

  return {
    days,
    timezone,
    currency: restaurant.currency,
    guests: {
      qrScans: eventCount("qr_scanned"),
      visits: visitsRow!.count,
      pageViews: eventCount("restaurant_viewed"),
      bookingViews: eventCount("booking_page_viewed"),
      visitors: visitorsRow!.visitors,
      returning: visitorsRow!.returning,
    },
    orders: {
      ...o,
      successRate: o.placed > 0 ? o.completed / o.placed : null,
      averageMinor: o.completed > 0 ? Math.round(o.revenueMinor / o.completed) : null,
    },
    reservations: reservationsRow!,
    reviews: reviewsRow!,
    daily: dates.map((date) => ({
      date,
      orders: daily.find((d) => d.date === date)?.orders ?? 0,
      revenueMinor: daily.find((d) => d.date === date)?.revenueMinor ?? 0,
      reservations: dailyRes.find((d) => d.date === date)?.count ?? 0,
    })),
    topItems: top,
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orders: byHour.find((h) => h.hour === hour)?.orders ?? 0,
    })),
  };
}
