import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  POS_CONNECTION_STATUSES,
  POS_OUTBOX_KINDS,
  POS_OUTBOX_STATUSES,
  type PosEntityType,
} from "@/shared/constants/pos";

import { timestamps } from "./_shared";
import { restaurantLocations, restaurants } from "./restaurants";

export const posConnectionStatus = pgEnum("pos_connection_status", POS_CONNECTION_STATUSES);
export const posOutboxKind = pgEnum("pos_outbox_kind", POS_OUTBOX_KINDS);
export const posOutboxStatus = pgEnum("pos_outbox_status", POS_OUTBOX_STATUSES);

/**
 * A location linked to its POS (§29). Optional: restaurants run fully on
 * Spot without one. `settings` holds non-secret options; credentials for
 * real providers belong in server environment variables, never here.
 */
export const posConnections = pgTable(
  "pos_connections",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    locationId: uuid().notNull(),
    provider: text().notNull(),
    status: posConnectionStatus().notNull().default("active"),
    settings: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),
    lastSyncAt: timestamp({ withTimezone: true }),
    lastError: text(),
    /** Password for a POS we call (1C HTTP service), encrypted with a key derived from AUTH_SECRET. */
    secretCiphertext: text(),
    /** SHA-256 of the token a POS that calls us (1C exchange) authenticates with. */
    exchangeTokenHash: text().unique(),
    /** A delivery run is sending this connection's outbox until then (one at a time, in order). */
    deliveryLeaseUntil: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "pos_connections_location_fk",
      columns: [t.locationId, t.restaurantId],
      foreignColumns: [restaurantLocations.id, restaurantLocations.restaurantId],
    }).onDelete("cascade"),
    // One live POS per location.
    uniqueIndex("pos_connections_one_active_per_location")
      .on(t.locationId)
      .where(sql`${t.status} = 'active'`),
  ],
);

/**
 * Changes waiting to reach the POS. Written after the change is saved and
 * delivered in the background with retries, so a slow or offline POS never
 * blocks ordering.
 */
export const posOutbox = pgTable(
  "pos_outbox",
  {
    id: uuid().primaryKey().defaultRandom(),
    connectionId: uuid()
      .notNull()
      .references(() => posConnections.id, { onDelete: "cascade" }),
    kind: posOutboxKind().notNull(),
    /** The order or bill it's about. */
    entityId: uuid().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    status: posOutboxStatus().notNull().default("pending"),
    attempts: smallint().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastError: text(),
    sentAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pos_outbox_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    index("pos_outbox_connection_idx").on(t.connectionId, t.createdAt),
  ],
);

/** Our ids ↔ the POS's ids (orders now; menu items and tables later). */
export const posExternalRefs = pgTable(
  "pos_external_refs",
  {
    id: uuid().primaryKey().defaultRandom(),
    connectionId: uuid()
      .notNull()
      .references(() => posConnections.id, { onDelete: "cascade" }),
    entityType: text().notNull().$type<PosEntityType>(),
    localId: uuid().notNull(),
    externalId: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pos_external_refs_local_unique").on(t.connectionId, t.entityType, t.localId),
    uniqueIndex("pos_external_refs_external_unique").on(t.connectionId, t.entityType, t.externalId),
  ],
);

/**
 * The latest catalog and stock a POS uploaded (POSes that call us, like
 * the 1C exchange). Linking and stock sync read from here.
 */
export const posCatalogSnapshots = pgTable("pos_catalog_snapshots", {
  connectionId: uuid()
    .primaryKey()
    .references(() => posConnections.id, { onDelete: "cascade" }),
  menu: jsonb().$type<
    { externalId: string; name: string; priceMinor: number; category?: string }[]
  >(),
  tables: jsonb().$type<{ externalId: string; number: string }[]>(),
  stock: jsonb().$type<{ externalId: string; available: number }[]>(),
  catalogReceivedAt: timestamp({ withTimezone: true }),
  stockReceivedAt: timestamp({ withTimezone: true }),
});

export type PosConnection = typeof posConnections.$inferSelect;
export type PosOutboxItem = typeof posOutbox.$inferSelect;
