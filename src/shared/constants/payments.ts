/** Payment states (§21). */
export const PAYMENT_STATUSES = [
  "pending",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** What a payment is for. Bills arrive in Phase 10. */
export const PAYMENT_PURPOSES = ["reservation_deposit", "bill"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const REFUND_STATUSES = ["pending", "succeeded", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
