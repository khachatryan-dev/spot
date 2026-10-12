import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { TABLE_REQUEST_STATUSES, TABLE_REQUEST_TYPES } from "@/shared/constants/table-requests";

import { restaurants } from "./restaurants";
import { tableSessionMembers, tableSessions } from "./table-sessions";
import { diningTables } from "./tables";
import { users } from "./users";

export const tableRequestType = pgEnum("table_request_type", TABLE_REQUEST_TYPES);
export const tableRequestStatus = pgEnum("table_request_status", TABLE_REQUEST_STATUSES);

/**
 * A guest asking for service from the table (§18): waiter, bill, water…
 * At most one open request of each type per table session.
 */
export const tableRequests = pgTable(
  "table_requests",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    tableId: uuid().notNull(),
    tableSessionId: uuid().notNull(),
    memberId: uuid().references(() => tableSessionMembers.id, { onDelete: "set null" }),
    type: tableRequestType().notNull(),
    note: text(),
    status: tableRequestStatus().notNull().default("pending"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp({ withTimezone: true }),
    acknowledgedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamp({ withTimezone: true }),
    completedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "table_requests_table_fk",
      columns: [t.tableId, t.restaurantId],
      foreignColumns: [diningTables.id, diningTables.restaurantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "table_requests_session_fk",
      columns: [t.tableSessionId, t.restaurantId],
      foreignColumns: [tableSessions.id, tableSessions.restaurantId],
    }).onDelete("cascade"),
    uniqueIndex("table_requests_one_open_per_type")
      .on(t.tableSessionId, t.type)
      .where(sql`${t.status} IN ('pending', 'acknowledged')`),
    index("table_requests_restaurant_status_idx").on(t.restaurantId, t.status, t.createdAt),
    check("table_requests_note_length", sql`${t.note} IS NULL OR length(${t.note}) <= 200`),
  ],
);

export type TableRequest = typeof tableRequests.$inferSelect;
