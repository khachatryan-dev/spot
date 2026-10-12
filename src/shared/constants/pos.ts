/** POS integration (§29). */
export const POS_CONNECTION_STATUSES = ["active", "disabled"] as const;
export type PosConnectionStatus = (typeof POS_CONNECTION_STATUSES)[number];

/** What gets sent to the POS: new orders, status changes, paid bills. */
export const POS_OUTBOX_KINDS = ["order_created", "order_updated", "bill_closed"] as const;
export type PosOutboxKind = (typeof POS_OUTBOX_KINDS)[number];

export const POS_OUTBOX_STATUSES = ["pending", "sent", "failed"] as const;
export type PosOutboxStatus = (typeof POS_OUTBOX_STATUSES)[number];

/** Retry delays after each failed attempt; after the last one the item is marked failed. */
export const POS_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
];

/** Kinds of our records linked to POS records. */
export const POS_ENTITY_TYPES = ["order", "menu_item", "table"] as const;
export type PosEntityType = (typeof POS_ENTITY_TYPES)[number];

/** How long one delivery run may hold a connection before another may take over. */
export const POS_DELIVERY_LEASE_MS = 2 * 60_000;
