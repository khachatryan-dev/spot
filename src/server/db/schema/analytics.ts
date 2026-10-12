import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { ANALYTICS_EVENTS } from "@/shared/constants/analytics";

import { restaurants } from "./restaurants";

export const analyticsEvent = pgEnum("analytics_event", ANALYTICS_EVENTS);

/**
 * Product events (§4.2) for metrics: what happened, where, and an
 * anonymous visitor key — a keyed hash, so returning visitors can be
 * counted but nobody can be identified. No names, emails or phone numbers,
 * ever. Deleted after ANALYTICS_RETENTION_DAYS by the daily job.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: analyticsEvent().notNull(),
    restaurantId: uuid().references(() => restaurants.id, { onDelete: "cascade" }),
    locationId: uuid(),
    visitorKey: text(),
    /** A few non-personal details, e.g. how many results a search had. */
    properties: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("analytics_events_name_time_idx").on(t.name, t.occurredAt),
    index("analytics_events_restaurant_time_idx").on(t.restaurantId, t.occurredAt),
  ],
);

export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect;
