/**
 * Bill states (§22): open while the visit goes on (lines follow the orders),
 * finalized when amounts are locked for payment, paid when the balance is
 * zero, void when cancelled before any payment.
 */
export const BILL_STATUSES = ["open", "finalized", "paid", "void"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

/** Upper bound for a service fee (basis points: 1000 = 10 %). */
export const MAX_SERVICE_FEE_BPS = 3000;

/** Armenian VAT: 20 %, included in menu prices (basis points). */
export const ARMENIA_VAT_BPS = 2000;

/** How a payment covers a bill (§23): an equal share, chosen lines, or what's left. */
export const BILL_PAYMENT_MODES = ["equal", "items", "full"] as const;
export type BillPaymentMode = (typeof BILL_PAYMENT_MODES)[number];

/** Online through the provider, or taken by staff at the table. */
export const BILL_PAYMENT_METHODS = ["online", "cash", "card_terminal"] as const;
export type BillPaymentMethod = (typeof BILL_PAYMENT_METHODS)[number];

export const BILL_PAYMENT_STATUSES = ["pending", "succeeded", "failed", "expired"] as const;
export type BillPaymentStatus = (typeof BILL_PAYMENT_STATUSES)[number];

/** Pending and succeeded payments hold their share or lines. */
export const ACTIVE_BILL_PAYMENT_STATUSES = ["pending", "succeeded"] as const;

/** How long an unfinished online payment keeps its share or lines. */
export const BILL_PAYMENT_HOLD_MINUTES = 15;
export const MAX_SPLIT_WAYS = 20;
