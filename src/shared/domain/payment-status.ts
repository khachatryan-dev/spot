import type { PaymentStatus } from "@/shared/constants/payments";

/*
 * Payment status rules (§21). Statuses only move forward: a late or repeated
 * provider message (webhooks arrive out of order) can never undo a success
 * or revive a failed payment.
 */

const NEXT: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ["processing", "succeeded", "failed", "cancelled"],
  processing: ["succeeded", "failed", "cancelled"],
  succeeded: ["partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  failed: [],
  cancelled: [],
  refunded: [],
};

export const canMovePayment = (from: PaymentStatus, to: PaymentStatus) => NEXT[from].includes(to);

/** Money was taken (and not all of it given back). */
export const isPaid = (status: PaymentStatus) =>
  status === "succeeded" || status === "partially_refunded";

export const isFinalPayment = (status: PaymentStatus) => NEXT[status].length === 0;

/** Status after refunding `refundedMinor` in total of `amountMinor`. */
export const statusAfterRefund = (amountMinor: number, refundedMinor: number): PaymentStatus =>
  refundedMinor >= amountMinor ? "refunded" : "partially_refunded";
