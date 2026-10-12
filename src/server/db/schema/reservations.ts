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

import { RESERVATION_STATUSES } from "@/shared/constants/reservations";
import { MAX_TABLE_CAPACITY } from "@/shared/constants/tables";

import { timestamps } from "./_shared";
import { restaurantLocations, restaurants } from "./restaurants";
import { diningTables } from "./tables";
import { users } from "./users";

export const reservationStatus = pgEnum("reservation_status", RESERVATION_STATUSES);

/**
 * A table booked for a time slot (§19). While a reservation is active its
 * table is held by a row in `reservation_holds`; that table's exclusion
 * constraint is what makes double booking impossible (§49.7).
 */
export const reservations = pgTable(
  "reservations",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    locationId: uuid().notNull(),
    tableId: uuid().notNull(),
    /** The signed-in guest who booked; null if they later delete their account. */
    customerUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    partySize: smallint().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    status: reservationStatus().notNull(),
    /** Contact details as given for this booking (kept even if the account changes). */
    contactName: text().notNull(),
    contactPhone: text().notNull(),
    note: text(),
    /** Deposit required when booked (minor units, restaurant currency); 0 = none. */
    depositMinor: integer().notNull().default(0),
    /** The payment accepted as this booking's deposit (no FK: payments reference reservations). */
    depositPaymentId: uuid(),
    confirmedAt: timestamp({ withTimezone: true }),
    arrivedAt: timestamp({ withTimezone: true }),
    seatedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelledByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    /** Shown to the guest when the restaurant cancels or declines. */
    cancellationReason: text(),
    noShowAt: timestamp({ withTimezone: true }),
    expiredAt: timestamp({ withTimezone: true }),
    /** The day-of reminder email went out (sent once). */
    reminderSentAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("reservations_id_restaurant_unique").on(t.id, t.restaurantId),
    foreignKey({
      name: "reservations_location_fk",
      columns: [t.locationId, t.restaurantId],
      foreignColumns: [restaurantLocations.id, restaurantLocations.restaurantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "reservations_table_restaurant_fk",
      columns: [t.tableId, t.restaurantId],
      foreignColumns: [diningTables.id, diningTables.restaurantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "reservations_table_location_fk",
      columns: [t.tableId, t.locationId],
      foreignColumns: [diningTables.id, diningTables.locationId],
    }).onDelete("restrict"),
    index("reservations_location_starts_idx").on(t.locationId, t.startsAt),
    index("reservations_customer_starts_idx").on(t.customerUserId, t.startsAt),
    check("reservations_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "reservations_party_size",
      sql`${t.partySize} BETWEEN 1 AND ${sql.raw(String(MAX_TABLE_CAPACITY))}`,
    ),
    check("reservations_contact_name", sql`length(trim(${t.contactName})) BETWEEN 1 AND 100`),
    check("reservations_contact_phone", sql`${t.contactPhone} ~ '^\\+?[0-9]{6,15}$'`),
    check("reservations_deposit", sql`${t.depositMinor} >= 0`),
    check("reservations_note_length", sql`${t.note} IS NULL OR length(${t.note}) <= 500`),
    check(
      "reservations_cancellation_reason_length",
      sql`${t.cancellationReason} IS NULL OR length(${t.cancellationReason}) <= 300`,
    ),
  ],
);

/**
 * A claim on a table for a time range (§19): a guest's temporary hold while
 * booking, the hold of an active reservation, or a staff block.
 *
 * An exclusion constraint (in migration 0017, which drizzle can't express)
 * forbids two unreleased holds on the same table with overlapping ranges.
 * An expired hold still counts until it is released, so the code that places
 * a hold first releases expired ones in the same transaction.
 */
export const reservationHolds = pgTable(
  "reservation_holds",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    tableId: uuid().notNull(),
    /** Set once the hold belongs to a reservation; null for a pending hold or a block. */
    reservationId: uuid(),
    /** Who placed it: the guest booking, or staff blocking the table. */
    createdByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    /** The party the table was held for; null for a staff block. */
    partySize: smallint(),
    /** Null: held until released (confirmed reservation, block). */
    expiresAt: timestamp({ withTimezone: true }),
    releasedAt: timestamp({ withTimezone: true }),
    /** Staff note for a block, e.g. "private event". */
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "reservation_holds_table_fk",
      columns: [t.tableId, t.restaurantId],
      foreignColumns: [diningTables.id, diningTables.restaurantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "reservation_holds_reservation_fk",
      columns: [t.reservationId, t.restaurantId],
      foreignColumns: [reservations.id, reservations.restaurantId],
    }).onDelete("cascade"),
    // A reservation holds at most one table at a time.
    uniqueIndex("reservation_holds_one_live_per_reservation")
      .on(t.reservationId)
      .where(sql`${t.releasedAt} IS NULL`),
    index("reservation_holds_table_idx").on(t.tableId, t.startsAt),
    index("reservation_holds_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.releasedAt} IS NULL AND ${t.expiresAt} IS NOT NULL`),
    check("reservation_holds_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "reservation_holds_party_size",
      sql`${t.partySize} IS NULL OR ${t.partySize} BETWEEN 1 AND ${sql.raw(String(MAX_TABLE_CAPACITY))}`,
    ),
    check("reservation_holds_note_length", sql`${t.note} IS NULL OR length(${t.note}) <= 200`),
  ],
);

export type Reservation = typeof reservations.$inferSelect;
export type ReservationHold = typeof reservationHolds.$inferSelect;
