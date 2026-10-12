import { sql } from "drizzle-orm";
import {
  boolean,
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

import { MAX_TABLE_CAPACITY, TABLE_STATUSES, TABLE_TYPES } from "@/shared/constants/tables";

import { timestamps } from "./_shared";
import { restaurantLocations, restaurants } from "./restaurants";
import { users } from "./users";

export const tableStatus = pgEnum("table_status", TABLE_STATUSES);
export const tableType = pgEnum("table_type", TABLE_TYPES);

/**
 * A physical table at a location (§12). The table number is what guests see;
 * the internal id is never used for QR access (§12, §13).
 */
export const diningTables = pgTable(
  "tables",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    locationId: uuid().notNull(),
    /** Label shown to guests and staff, e.g. "12" or "A3". */
    number: text().notNull(),
    name: text(),
    capacity: smallint().notNull().default(4),
    /** e.g. "Terrace", "Hall 2". */
    zone: text(),
    type: tableType().notNull().default("standard"),
    status: tableStatus().notNull().default("available"),
    /** Deactivate instead of deleting: orders and reservations reference tables. */
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("tables_id_restaurant_unique").on(t.id, t.restaurantId),
    // Target for reservations: a booked table must be at the booked location.
    unique("tables_id_location_unique").on(t.id, t.locationId),
    foreignKey({
      name: "tables_location_fk",
      columns: [t.locationId, t.restaurantId],
      foreignColumns: [restaurantLocations.id, restaurantLocations.restaurantId],
    }).onDelete("restrict"),
    // "12" and "12 " or "a3" and "A3" are the same table.
    uniqueIndex("tables_location_number_unique").on(t.locationId, sql`lower(trim(${t.number}))`),
    index("tables_location_idx").on(t.locationId, t.sortOrder),
    check(
      "tables_capacity",
      sql`${t.capacity} BETWEEN 1 AND ${sql.raw(String(MAX_TABLE_CAPACITY))}`,
    ),
    check("tables_number_not_blank", sql`length(trim(${t.number})) BETWEEN 1 AND 20`),
  ],
);

/**
 * QR codes for tables (§13). The token is a 128-bit random value — never the
 * table id or number. It is stored as-is (unlike passwords or invitation
 * tokens) because it is printed on the table, not a secret; what matters is
 * that it's unguessable and revocable. Storing it lets owners re-print a lost
 * code without invalidating the ones already on tables.
 *
 * Rows are never deleted: rotating revokes the old token and creates a new one,
 * which keeps the audit history.
 */
export const qrTokens = pgTable(
  "qr_tokens",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    tableId: uuid().notNull(),
    token: text().notNull().unique(),
    createdByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    /** Optional hard expiry (e.g. event tables). */
    expiresAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    revokedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    lastScannedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "qr_tokens_table_fk",
      columns: [t.tableId, t.restaurantId],
      foreignColumns: [diningTables.id, diningTables.restaurantId],
    }).onDelete("cascade"),
    // At most one live token per table.
    uniqueIndex("qr_tokens_one_active_per_table")
      .on(t.tableId)
      .where(sql`${t.revokedAt} IS NULL`),
    index("qr_tokens_table_idx").on(t.tableId),
    check("qr_tokens_token_format", sql`${t.token} ~ '^[A-Za-z0-9_-]{22,64}$'`),
  ],
);

export type DiningTable = typeof diningTables.$inferSelect;
export type QrToken = typeof qrTokens.$inferSelect;
