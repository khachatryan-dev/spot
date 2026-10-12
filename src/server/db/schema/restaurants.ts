import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
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
  LOCATION_STATUSES,
  RESTAURANT_STATUSES,
  STAFF_STATUSES,
} from "@/shared/constants/restaurants";
import { MAX_SERVICE_FEE_BPS } from "@/shared/constants/bills";
import type { Cuisine } from "@/shared/constants/cuisines";
import {
  MAX_DEPOSIT_MINOR,
  REFUND_CUTOFF_HOURS,
  RESERVATION_CONFIRMATION_MODES,
  RESERVATION_DEPOSIT_TYPES,
  RESERVATION_DURATION,
  RESERVATION_MAX_DAYS_AHEAD,
  RESERVATION_MIN_NOTICE,
} from "@/shared/constants/reservations";
import { CLOSED_ALL_WEEK, type OpeningHours } from "@/shared/schemas/opening-hours";

import { timestamps } from "./_shared";
import { restaurantRole } from "./roles";
import { users } from "./users";

export const restaurantStatus = pgEnum("restaurant_status", RESTAURANT_STATUSES);
export const staffStatus = pgEnum("staff_status", STAFF_STATUSES);
export const locationStatus = pgEnum("location_status", LOCATION_STATUSES);
export const reservationConfirmationMode = pgEnum(
  "reservation_confirmation_mode",
  RESERVATION_CONFIRMATION_MODES,
);
export const reservationDepositType = pgEnum("reservation_deposit_type", RESERVATION_DEPOSIT_TYPES);

const SLUG_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";

/** A restaurant brand (tenant root, §8). Only ACTIVE restaurants are public (§10). */
export const restaurants = pgTable(
  "restaurants",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    /** URL handle, e.g. /r/example-coffee. */
    slug: text().notNull().unique(),
    status: restaurantStatus().notNull().default("draft"),
    description: text(),
    cuisines: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`)
      .$type<Cuisine[]>(),
    /** 1 (budget) to 4 (fine dining). */
    priceRange: smallint(),
    /** ISO 4217; menu prices are stored in this currency's minor units. */
    currency: text().notNull().default("AMD"),
    /** VAT included in prices, shown on bills (basis points); 0 = not a VAT payer. */
    vatRateBps: smallint().notNull().default(0),
    phone: text(),
    email: text(),
    website: text(),
    /** Object-storage keys (Day 20), never binary data (§31). */
    logoKey: text(),
    coverImageKey: text(),
    submittedAt: timestamp({ withTimezone: true }),
    approvedAt: timestamp({ withTimezone: true }),
    /** Why a restaurant was rejected or suspended (shown to the owner). */
    statusReason: text(),
    ...timestamps,
  },
  (table) => [
    index("restaurants_status_idx").on(table.status),
    check("restaurants_slug_format", sql`${table.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`),
    check(
      "restaurants_price_range",
      sql`${table.priceRange} IS NULL OR ${table.priceRange} BETWEEN 1 AND 4`,
    ),
    check("restaurants_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("restaurants_vat_rate", sql`${table.vatRateBps} BETWEEN 0 AND 5000`),
  ],
);

/**
 * A physical place of a restaurant (§11). Tables, menus, orders and
 * reservations hang off a location.
 */
export const restaurantLocations = pgTable(
  "restaurant_locations",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    name: text().notNull(),
    /** Unique within the restaurant, e.g. /r/example-coffee/cascade. */
    slug: text().notNull(),
    status: locationStatus().notNull().default("active"),
    addressLine: text().notNull(),
    city: text().notNull(),
    /** ISO 3166-1 alpha-2. */
    country: text().notNull().default("AM"),
    postalCode: text(),
    latitude: doublePrecision(),
    longitude: doublePrecision(),
    phone: text(),
    /** IANA zone; opening hours and reservations are in this local time. */
    timezone: text().notNull().default("Asia/Yerevan"),
    openingHours: jsonb().$type<OpeningHours>().notNull().default(CLOSED_ALL_WEEK),
    reservationsEnabled: boolean().notNull().default(false),
    /** auto: a free table is booked at once; manual: staff confirm each request. */
    reservationConfirmation: reservationConfirmationMode().notNull().default("manual"),
    /** How long a reservation keeps its table. */
    reservationDurationMinutes: smallint().notNull().default(RESERVATION_DURATION.default),
    /** Earliest a guest can book ahead of the start time. */
    reservationMinNoticeMinutes: integer().notNull().default(RESERVATION_MIN_NOTICE.default),
    /** Latest day a guest can book, counted from today. */
    reservationMaxDaysAhead: smallint().notNull().default(RESERVATION_MAX_DAYS_AHEAD.default),
    /** Deposit to confirm a booking, in the restaurant's currency (minor units). */
    reservationDepositType: reservationDepositType().notNull().default("none"),
    reservationDepositMinor: integer().notNull().default(0),
    /** Guests cancelling at least this many hours ahead get the deposit back. */
    reservationRefundCutoffHours: smallint().notNull().default(REFUND_CUTOFF_HOURS.default),
    /** Service charge added to bills (basis points: 1000 = 10 %). */
    serviceFeeBps: smallint().notNull().default(0),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("restaurant_locations_restaurant_slug_unique").on(table.restaurantId, table.slug),
    // Target for tenant-safe composite foreign keys (e.g. menu_locations).
    unique("restaurant_locations_id_restaurant_unique").on(table.id, table.restaurantId),
    index("restaurant_locations_restaurant_id_idx").on(table.restaurantId),
    check("restaurant_locations_slug_format", sql`${table.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`),
    check(
      "restaurant_locations_reservation_settings",
      sql.raw(
        `reservation_duration_minutes BETWEEN ${RESERVATION_DURATION.min} AND ${RESERVATION_DURATION.max}` +
          ` AND reservation_min_notice_minutes BETWEEN ${RESERVATION_MIN_NOTICE.min} AND ${RESERVATION_MIN_NOTICE.max}` +
          ` AND reservation_max_days_ahead BETWEEN ${RESERVATION_MAX_DAYS_AHEAD.min} AND ${RESERVATION_MAX_DAYS_AHEAD.max}`,
      ),
    ),
    check(
      "restaurant_locations_deposit",
      sql.raw(
        `(reservation_deposit_type = 'none' OR reservation_deposit_minor > 0)` +
          ` AND reservation_deposit_minor BETWEEN 0 AND ${MAX_DEPOSIT_MINOR}` +
          ` AND reservation_refund_cutoff_hours BETWEEN ${REFUND_CUTOFF_HOURS.min} AND ${REFUND_CUTOFF_HOURS.max}`,
      ),
    ),
    check(
      "restaurant_locations_service_fee",
      sql.raw(`service_fee_bps BETWEEN 0 AND ${MAX_SERVICE_FEE_BPS}`),
    ),
    check("restaurant_locations_country_format", sql`${table.country} ~ '^[A-Z]{2}$'`),
    check(
      "restaurant_locations_coordinates",
      // Spelled out with IS NOT NULL: a CHECK that evaluates to NULL counts as passing.
      sql`(${table.latitude} IS NULL AND ${table.longitude} IS NULL) OR (${table.latitude} IS NOT NULL AND ${table.longitude} IS NOT NULL AND ${table.latitude} BETWEEN -90 AND 90 AND ${table.longitude} BETWEEN -180 AND 180)`,
    ),
  ],
);

/**
 * Who works at a restaurant and in which role (§9). One role per person per
 * restaurant; the same person can hold different roles at different restaurants.
 */
export const restaurantStaff = pgTable(
  "restaurant_staff",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: restaurantRole().notNull(),
    status: staffStatus().notNull().default("active"),
    invitedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("restaurant_staff_restaurant_user_unique").on(table.restaurantId, table.userId),
    index("restaurant_staff_user_id_idx").on(table.userId),
  ],
);

export type Restaurant = typeof restaurants.$inferSelect;
export type RestaurantLocation = typeof restaurantLocations.$inferSelect;
export type RestaurantStaff = typeof restaurantStaff.$inferSelect;

/**
 * Pending staff invitations (§9). Shared as a link containing a random token;
 * only its hash is stored. Accepting requires an account with the same email.
 */
export const staffInvitations = pgTable(
  "staff_invitations",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    /** Stored lowercase. */
    email: text().notNull(),
    role: restaurantRole().notNull(),
    tokenHash: text().notNull().unique(),
    invitedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    acceptedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // At most one open invitation per email per restaurant.
    uniqueIndex("staff_invitations_open_unique")
      .on(table.restaurantId, table.email)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    check("staff_invitations_email_lowercase", sql`${table.email} = lower(${table.email})`),
  ],
);

export type StaffInvitation = typeof staffInvitations.$inferSelect;
