/**
 * Product events (§4.2) that leave no other trace in the database. Orders,
 * reservations, visits, payments and reviews are counted from their own
 * tables.
 */
export const ANALYTICS_EVENTS = [
  "qr_scanned",
  "restaurant_viewed",
  "booking_page_viewed",
  "search_performed",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Events are deleted after this many days (privacy: keep only what metrics need). */
export const ANALYTICS_RETENTION_DAYS = 400;
