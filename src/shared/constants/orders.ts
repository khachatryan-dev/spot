/**
 * Order lifecycle (§16). There is no DRAFT: the guest's cart is the draft,
 * so an order starts as SUBMITTED. CANCELLED and REJECTED are terminal.
 */
export const ORDER_STATUSES = [
  "submitted",
  "received",
  "accepted",
  "preparing",
  "ready",
  "served",
  "completed",
  "cancelled",
  "rejected",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
