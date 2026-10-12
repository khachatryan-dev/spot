/** Restaurant lifecycle (§10): DRAFT → PENDING_REVIEW → ACTIVE → SUSPENDED → CLOSED. */
export const RESTAURANT_STATUSES = [
  "draft",
  "pending_review",
  "active",
  "suspended",
  "closed",
] as const;
export type RestaurantStatus = (typeof RESTAURANT_STATUSES)[number];

/** A disabled staff member keeps their history but loses all access. */
export const STAFF_STATUSES = ["active", "disabled"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

/** An inactive location is hidden from customers but keeps its data. */
export const LOCATION_STATUSES = ["active", "inactive"] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];
