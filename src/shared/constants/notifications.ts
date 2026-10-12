/** In-app notification kinds (§27). The text is rendered per reader's language. */
export const NOTIFICATION_TYPES = [
  "reservation_requested", // staff: a guest asks for a table
  "reservation_confirmed", // guest
  "reservation_declined", // guest
  "reservation_cancelled_by_restaurant", // guest
  "reservation_cancelled_by_guest", // staff
  "deposit_paid", // guest
  "refund_issued", // guest
  "review_replied", // guest (review author)
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const EMAIL_STATUSES = ["pending", "sent", "logged", "failed"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
