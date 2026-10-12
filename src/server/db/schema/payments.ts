import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { PAYMENT_PURPOSES, PAYMENT_STATUSES, REFUND_STATUSES } from "@/shared/constants/payments";

import { timestamps } from "./_shared";
import { reservations } from "./reservations";
import { restaurants } from "./restaurants";
import { users } from "./users";

export const paymentStatus = pgEnum("payment_status", PAYMENT_STATUSES);
export const paymentPurpose = pgEnum("payment_purpose", PAYMENT_PURPOSES);
export const refundStatus = pgEnum("refund_status", REFUND_STATUSES);

/**
 * Money a guest pays through a provider (§21). Financial record: never
 * deleted, and amount/currency/provider can't change once created (triggers
 * in migration 0019). The status only changes through PaymentService after
 * the provider confirms it — never from the browser (§49.4).
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    purpose: paymentPurpose().notNull(),
    reservationId: uuid(),
    customerUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    amountMinor: integer().notNull(),
    /** ISO 4217, the restaurant's currency at payment time. */
    currency: text().notNull(),
    status: paymentStatus().notNull().default("pending"),
    provider: text().notNull(),
    /** Set once the provider has created its side of the payment. */
    providerPaymentId: text(),
    /** Retrying the same request (double click, network retry) reuses the payment. */
    idempotencyKey: text().notNull().unique(),
    refundedMinor: integer().notNull().default(0),
    failureReason: text(),
    succeededAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("payments_id_restaurant_unique").on(t.id, t.restaurantId),
    foreignKey({
      name: "payments_reservation_fk",
      columns: [t.reservationId, t.restaurantId],
      foreignColumns: [reservations.id, reservations.restaurantId],
    }).onDelete("restrict"),
    uniqueIndex("payments_provider_payment_unique")
      .on(t.provider, t.providerPaymentId)
      .where(sql`${t.providerPaymentId} IS NOT NULL`),
    index("payments_restaurant_created_idx").on(t.restaurantId, t.createdAt),
    index("payments_reservation_idx").on(t.reservationId),
    check("payments_amount_positive", sql`${t.amountMinor} > 0`),
    check(
      "payments_refunded_range",
      sql`${t.refundedMinor} >= 0 AND ${t.refundedMinor} <= ${t.amountMinor}`,
    ),
    check("payments_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "payments_purpose_target",
      sql`${t.purpose} <> 'reservation_deposit' OR ${t.reservationId} IS NOT NULL`,
    ),
  ],
);

/**
 * Everything that happened to a payment, append-only (§21: logged). Provider
 * events are unique per provider, which makes webhook handling idempotent.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    provider: text().notNull(),
    /** The provider's event id (webhooks); null for our own entries. */
    providerEventId: text(),
    /** e.g. "created", "status_changed", "refunded", "amount_mismatch". */
    type: text().notNull(),
    fromStatus: paymentStatus(),
    toStatus: paymentStatus(),
    amountMinor: integer(),
    /** Non-sensitive details only — never card data. */
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_events_provider_event_unique")
      .on(t.provider, t.providerEventId)
      .where(sql`${t.providerEventId} IS NOT NULL`),
    index("payment_events_payment_idx").on(t.paymentId, t.createdAt),
  ],
);

/**
 * A refund of all or part of a payment (§21). While pending, its amount
 * counts against what can still be refunded, so concurrent refunds can never
 * exceed the payment. Financial record: no deletes, amount fixed (migration 0020).
 */
export const paymentRefunds = pgTable(
  "payment_refunds",
  {
    id: uuid().primaryKey().defaultRandom(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    amountMinor: integer().notNull(),
    reason: text().notNull(),
    status: refundStatus().notNull().default("pending"),
    providerRefundId: text(),
    /** One refund per key: a double click or retry never refunds twice. */
    idempotencyKey: text().notNull().unique(),
    requestedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("payment_refunds_payment_idx").on(t.paymentId),
    check("payment_refunds_amount_positive", sql`${t.amountMinor} > 0`),
    check("payment_refunds_reason_length", sql`length(trim(${t.reason})) BETWEEN 3 AND 300`),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type PaymentRefund = typeof paymentRefunds.$inferSelect;
export type PaymentEvent = typeof paymentEvents.$inferSelect;
