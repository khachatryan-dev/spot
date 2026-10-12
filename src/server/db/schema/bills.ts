import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  BILL_PAYMENT_METHODS,
  BILL_PAYMENT_MODES,
  BILL_PAYMENT_STATUSES,
  BILL_STATUSES,
  MAX_SERVICE_FEE_BPS,
  MAX_SPLIT_WAYS,
} from "@/shared/constants/bills";

import { timestamps } from "./_shared";
import { payments } from "./payments";
import { restaurantLocations, restaurants } from "./restaurants";
import { tableSessionMembers, tableSessions } from "./table-sessions";
import { diningTables } from "./tables";
import { users } from "./users";

export const billStatus = pgEnum("bill_status", BILL_STATUSES);
export const billPaymentMode = pgEnum("bill_payment_mode", BILL_PAYMENT_MODES);
export const billPaymentMethod = pgEnum("bill_payment_method", BILL_PAYMENT_METHODS);
export const billPaymentStatus = pgEnum("bill_payment_status", BILL_PAYMENT_STATUSES);

/**
 * The bill for one table visit (§22). Financial record: never deleted. Once
 * finalized its amounts and lines can't change and it can't reopen; when it
 * is finalized the lines must add up to the subtotal (triggers, migration 0023).
 *
 *   total = subtotal − discount + service fee
 *   taxIncluded is the VAT already inside the prices (shown, not added).
 */
export const bills = pgTable(
  "bills",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    locationId: uuid().notNull(),
    tableId: uuid().notNull(),
    tableSessionId: uuid().notNull(),
    status: billStatus().notNull().default("open"),
    /** ISO 4217, the restaurant's currency when the bill was opened. */
    currency: text().notNull(),
    subtotalMinor: integer().notNull().default(0),
    discountMinor: integer().notNull().default(0),
    /** Service charge rate at finalization (basis points) and its amount. */
    serviceFeeBps: smallint().notNull().default(0),
    serviceFeeMinor: integer().notNull().default(0),
    /** VAT rate at finalization (basis points) and the VAT inside the total. */
    vatRateBps: smallint().notNull().default(0),
    taxIncludedMinor: integer().notNull().default(0),
    totalMinor: integer().notNull().default(0),
    /** Sum of successful payments allocated to this bill (server-calculated, §23). */
    paidMinor: integer().notNull().default(0),
    finalizedAt: timestamp({ withTimezone: true }),
    finalizedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    paidAt: timestamp({ withTimezone: true }),
    voidedAt: timestamp({ withTimezone: true }),
    voidReason: text(),
    ...timestamps,
  },
  (t) => [
    unique("bills_id_restaurant_unique").on(t.id, t.restaurantId),
    foreignKey({
      name: "bills_location_fk",
      columns: [t.locationId, t.restaurantId],
      foreignColumns: [restaurantLocations.id, restaurantLocations.restaurantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "bills_table_fk",
      columns: [t.tableId, t.restaurantId],
      foreignColumns: [diningTables.id, diningTables.restaurantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "bills_session_fk",
      columns: [t.tableSessionId, t.restaurantId],
      foreignColumns: [tableSessions.id, tableSessions.restaurantId],
    }).onDelete("restrict"),
    // One live bill per visit; a voided one can be replaced.
    uniqueIndex("bills_one_per_session")
      .on(t.tableSessionId)
      .where(sql`${t.status} <> 'void'`),
    index("bills_restaurant_status_idx").on(t.restaurantId, t.status, t.createdAt),
    check("bills_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "bills_amounts",
      sql`${t.subtotalMinor} >= 0 AND ${t.discountMinor} >= 0 AND ${t.discountMinor} <= ${t.subtotalMinor}
        AND ${t.serviceFeeMinor} >= 0 AND ${t.taxIncludedMinor} >= 0 AND ${t.taxIncludedMinor} <= ${t.totalMinor}`,
    ),
    check(
      "bills_total",
      sql`${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor} + ${t.serviceFeeMinor}`,
    ),
    check(
      "bills_service_fee_rate",
      sql`${t.serviceFeeBps} BETWEEN 0 AND ${sql.raw(String(MAX_SERVICE_FEE_BPS))}`,
    ),
    check("bills_paid_range", sql`${t.paidMinor} >= 0 AND ${t.paidMinor} <= ${t.totalMinor}`),
    check(
      "bills_paid_means_settled",
      sql`${t.status} <> 'paid' OR (${t.paidMinor} = ${t.totalMinor} AND ${t.paidAt} IS NOT NULL)`,
    ),
    check(
      "bills_void_unpaid",
      sql`${t.status} <> 'void' OR (${t.paidMinor} = 0 AND ${t.voidReason} IS NOT NULL)`,
    ),
  ],
);

export interface BillItemOption {
  group: string;
  name: string;
  priceDeltaMinor: number;
}

/**
 * A line on a bill: a snapshot of an order line (§22: item, quantity, unit
 * and modifier prices). Locked with its bill once finalized.
 */
export const billItems = pgTable(
  "bill_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid().notNull(),
    billId: uuid().notNull(),
    /** The order line it copies (plain reference: the snapshot is the record). */
    orderItemId: uuid(),
    /** The guest who ordered it, for "pay my own items" (§23). */
    memberId: uuid().references(() => tableSessionMembers.id, { onDelete: "set null" }),
    name: text().notNull(),
    options: jsonb().$type<BillItemOption[]>().notNull().default([]),
    unitPriceMinor: integer().notNull(),
    modifiersTotalMinor: integer().notNull().default(0),
    quantity: smallint().notNull(),
    lineTotalMinor: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("bill_items_id_restaurant_unique").on(t.id, t.restaurantId),
    foreignKey({
      name: "bill_items_bill_fk",
      columns: [t.billId, t.restaurantId],
      foreignColumns: [bills.id, bills.restaurantId],
    }).onDelete("restrict"),
    uniqueIndex("bill_items_order_item_unique")
      .on(t.billId, t.orderItemId)
      .where(sql`${t.orderItemId} IS NOT NULL`),
    index("bill_items_bill_idx").on(t.billId),
    check("bill_items_quantity", sql`${t.quantity} BETWEEN 1 AND 50`),
    check("bill_items_prices", sql`${t.unitPriceMinor} >= 0 AND ${t.modifiersTotalMinor} >= 0`),
    check(
      "bill_items_line_total",
      sql`${t.lineTotalMinor} = (${t.unitPriceMinor} + ${t.modifiersTotalMinor}) * ${t.quantity}`,
    ),
  ],
);

/**
 * Money toward a bill (§23): one equal share, chosen lines, or the rest;
 * paid online (linked payment) or taken by staff. Pending and succeeded
 * payments hold what they cover, so it can't be paid twice: a share index
 * is unique among them, and so is each line (bill_payment_items). Financial
 * record: no deletes, amount fixed (migration 0025).
 */
export const billPayments = pgTable(
  "bill_payments",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid().notNull(),
    billId: uuid().notNull(),
    mode: billPaymentMode().notNull(),
    /** Equal split: this is share `shareIndex` (1-based) of `shareCount`. */
    shareIndex: smallint(),
    shareCount: smallint(),
    amountMinor: integer().notNull(),
    method: billPaymentMethod().notNull(),
    status: billPaymentStatus().notNull(),
    /** The provider payment, for online payments. */
    paymentId: uuid().references(() => payments.id, { onDelete: "restrict" }),
    /** The guest paying (their visit membership), if paid by a guest. */
    memberId: uuid().references(() => tableSessionMembers.id, { onDelete: "set null" }),
    /** Staff who took a cash or terminal payment. */
    recordedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    /** An unfinished online payment releases its share or lines after this. */
    expiresAt: timestamp({ withTimezone: true }),
    settledAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("bill_payments_id_restaurant_unique").on(t.id, t.restaurantId),
    foreignKey({
      name: "bill_payments_bill_fk",
      columns: [t.billId, t.restaurantId],
      foreignColumns: [bills.id, bills.restaurantId],
    }).onDelete("restrict"),
    uniqueIndex("bill_payments_payment_unique")
      .on(t.paymentId)
      .where(sql`${t.paymentId} IS NOT NULL`),
    uniqueIndex("bill_payments_one_per_share")
      .on(t.billId, t.shareIndex)
      .where(sql`${t.shareIndex} IS NOT NULL AND ${t.status} IN ('pending', 'succeeded')`),
    index("bill_payments_bill_idx").on(t.billId),
    check("bill_payments_amount_positive", sql`${t.amountMinor} > 0`),
    check(
      "bill_payments_share",
      sql`(${t.mode} = 'equal') = (${t.shareIndex} IS NOT NULL AND ${t.shareCount} IS NOT NULL)
        AND (${t.shareCount} IS NULL OR (${t.shareCount} BETWEEN 2 AND ${sql.raw(String(MAX_SPLIT_WAYS))}
          AND ${t.shareIndex} BETWEEN 1 AND ${t.shareCount}))`,
    ),
    // Online: linked to its provider payment before it can succeed.
    // Staff-taken: no provider payment, and someone recorded it.
    check(
      "bill_payments_method",
      sql`(${t.method} = 'online' AND (${t.paymentId} IS NOT NULL OR ${t.status} <> 'succeeded'))
        OR (${t.method} <> 'online' AND ${t.paymentId} IS NULL AND ${t.recordedByUserId} IS NOT NULL)`,
    ),
  ],
);

/** The bill lines a payment covers ("items" mode). `active` mirrors the payment holding them. */
export const billPaymentItems = pgTable(
  "bill_payment_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid().notNull(),
    billPaymentId: uuid().notNull(),
    billItemId: uuid().notNull(),
    active: boolean().notNull().default(true),
  },
  (t) => [
    foreignKey({
      name: "bill_payment_items_payment_fk",
      columns: [t.billPaymentId, t.restaurantId],
      foreignColumns: [billPayments.id, billPayments.restaurantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "bill_payment_items_item_fk",
      columns: [t.billItemId, t.restaurantId],
      foreignColumns: [billItems.id, billItems.restaurantId],
    }).onDelete("restrict"),
    // A line is paid by at most one live payment.
    uniqueIndex("bill_payment_items_one_live")
      .on(t.billItemId)
      .where(sql`${t.active}`),
    index("bill_payment_items_payment_idx").on(t.billPaymentId),
  ],
);

export type Bill = typeof bills.$inferSelect;
export type BillPayment = typeof billPayments.$inferSelect;
export type BillItem = typeof billItems.$inferSelect;
