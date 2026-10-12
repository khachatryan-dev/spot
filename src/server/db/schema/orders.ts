import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ORDER_STATUSES } from "@/shared/constants/orders";

import { timestamps } from "./_shared";
import { restaurantLocations, restaurants } from "./restaurants";
import { tableSessionMembers, tableSessions } from "./table-sessions";
import { diningTables } from "./tables";
import { users } from "./users";

export const orderStatus = pgEnum("order_status", ORDER_STATUSES);

/** Next order number per restaurant (#1, #2, …), incremented atomically. */
export const orderNumberCounters = pgTable("order_number_counters", {
  restaurantId: uuid()
    .primaryKey()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  lastNumber: integer().notNull().default(0),
});

/**
 * An order from a table (§16). Financial record: never deleted, and its
 * amounts and currency can't change after creation (triggers in migration).
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    locationId: uuid().notNull(),
    tableId: uuid().notNull(),
    tableSessionId: uuid().notNull(),
    /** Who placed it; null only if that member record is ever removed. */
    memberId: uuid().references(() => tableSessionMembers.id, { onDelete: "set null" }),
    /** Human-readable number per restaurant, e.g. #1042. */
    number: integer().notNull(),
    status: orderStatus().notNull().default("submitted"),
    /** Snapshot of the restaurant currency at order time (ISO 4217). */
    currency: text().notNull(),
    subtotalMinor: integer().notNull(),
    discountMinor: integer().notNull().default(0),
    totalMinor: integer().notNull(),
    note: text(),
    /** Client-generated key: retries and double taps can't create a second order. */
    idempotencyKey: text().notNull(),
    submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp({ withTimezone: true }),
    readyAt: timestamp({ withTimezone: true }),
    servedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),
    ...timestamps,
  },
  (t) => [
    unique("orders_id_restaurant_unique").on(t.id, t.restaurantId),
    uniqueIndex("orders_restaurant_number_unique").on(t.restaurantId, t.number),
    uniqueIndex("orders_session_idempotency_unique").on(t.tableSessionId, t.idempotencyKey),
    foreignKey({
      name: "orders_location_fk",
      columns: [t.locationId, t.restaurantId],
      foreignColumns: [restaurantLocations.id, restaurantLocations.restaurantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "orders_table_fk",
      columns: [t.tableId, t.restaurantId],
      foreignColumns: [diningTables.id, diningTables.restaurantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "orders_session_fk",
      columns: [t.tableSessionId, t.restaurantId],
      foreignColumns: [tableSessions.id, tableSessions.restaurantId],
    }).onDelete("restrict"),
    index("orders_restaurant_status_idx").on(t.restaurantId, t.status, t.submittedAt),
    index("orders_location_submitted_idx").on(t.locationId, t.submittedAt),
    index("orders_session_idx").on(t.tableSessionId),
    check(
      "orders_amounts",
      sql`${t.subtotalMinor} >= 0 AND ${t.discountMinor} >= 0 AND ${t.discountMinor} <= ${t.subtotalMinor}`,
    ),
    check("orders_total", sql`${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor}`),
    check("orders_number_positive", sql`${t.number} > 0`),
    check("orders_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("orders_idempotency_key", sql`length(${t.idempotencyKey}) BETWEEN 8 AND 100`),
  ],
);

/** One line of an order, with a snapshot of the item as it was when ordered. */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid().notNull(),
    orderId: uuid().notNull(),
    /**
     * The menu item this came from. A plain reference, not a foreign key: lines
     * are immutable, and owners must still be able to delete menu items. It
     * may point to a deleted item — the snapshot below is the record.
     */
    menuItemId: uuid(),
    name: text().notNull(),
    unitPriceMinor: integer().notNull(),
    modifiersTotalMinor: integer().notNull().default(0),
    quantity: smallint().notNull(),
    lineTotalMinor: integer().notNull(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("order_items_id_restaurant_unique").on(t.id, t.restaurantId),
    foreignKey({
      name: "order_items_order_fk",
      columns: [t.orderId, t.restaurantId],
      foreignColumns: [orders.id, orders.restaurantId],
    }).onDelete("cascade"),
    index("order_items_order_idx").on(t.orderId),
    check("order_items_quantity", sql`${t.quantity} BETWEEN 1 AND 50`),
    check("order_items_prices", sql`${t.unitPriceMinor} >= 0 AND ${t.modifiersTotalMinor} >= 0`),
    check(
      "order_items_line_total",
      sql`${t.lineTotalMinor} = (${t.unitPriceMinor} + ${t.modifiersTotalMinor}) * ${t.quantity}`,
    ),
  ],
);

/** Options chosen for an order line, snapshotted (group, name, price). */
export const orderItemModifiers = pgTable(
  "order_item_modifiers",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid().notNull(),
    orderItemId: uuid().notNull(),
    /** Plain reference (see orderItems.menuItemId); the snapshot is the record. */
    modifierId: uuid(),
    groupName: text().notNull(),
    name: text().notNull(),
    priceDeltaMinor: integer().notNull(),
  },
  (t) => [
    foreignKey({
      name: "order_item_modifiers_item_fk",
      columns: [t.orderItemId, t.restaurantId],
      foreignColumns: [orderItems.id, orderItems.restaurantId],
    }).onDelete("cascade"),
    index("order_item_modifiers_item_idx").on(t.orderItemId),
    check("order_item_modifiers_price", sql`${t.priceDeltaMinor} >= 0`),
  ],
);

/** Every status change of an order (§16). Append-only. */
export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid().notNull(),
    orderId: uuid().notNull(),
    fromStatus: orderStatus(),
    toStatus: orderStatus().notNull(),
    /** Staff member who changed it; null for the customer or the system. */
    changedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    note: text(),
    changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "order_status_history_order_fk",
      columns: [t.orderId, t.restaurantId],
      foreignColumns: [orders.id, orders.restaurantId],
    }).onDelete("cascade"),
    index("order_status_history_order_idx").on(t.orderId, t.changedAt),
  ],
);

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderItemModifier = typeof orderItemModifiers.$inferSelect;
export type OrderStatusChange = typeof orderStatusHistory.$inferSelect;
