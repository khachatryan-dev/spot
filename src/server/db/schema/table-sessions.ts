import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  TABLE_SESSION_CLOSE_REASONS,
  TABLE_SESSION_STATUSES,
} from "@/shared/constants/table-sessions";

import { timestamps } from "./_shared";
import { guests } from "./guests";
import { restaurants } from "./restaurants";
import { diningTables, qrTokens } from "./tables";
import { users } from "./users";

export const tableSessionStatus = pgEnum("table_session_status", TABLE_SESSION_STATUSES);
export const tableSessionCloseReason = pgEnum(
  "table_session_close_reason",
  TABLE_SESSION_CLOSE_REASONS,
);

/**
 * One real visit at a table (§14). Several customers join the same session;
 * the restaurant sees it as one table. At most one open session per table.
 */
export const tableSessions = pgTable(
  "table_sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    tableId: uuid().notNull(),
    /** Short code staff can read out, e.g. "K7M2QX" (§14 "Session #ABC123"). */
    code: text().notNull(),
    status: tableSessionStatus().notNull().default("open"),
    openedViaQrTokenId: uuid().references(() => qrTokens.id, { onDelete: "set null" }),
    /** Bumped on joins and orders; idle sessions are treated as finished. */
    lastActivityAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true }),
    closedReason: tableSessionCloseReason(),
    closedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "table_sessions_table_fk",
      columns: [t.tableId, t.restaurantId],
      foreignColumns: [diningTables.id, diningTables.restaurantId],
    }).onDelete("cascade"),
    // Target for tenant-safe composite foreign keys (orders).
    unique("table_sessions_id_restaurant_unique").on(t.id, t.restaurantId),
    uniqueIndex("table_sessions_one_open_per_table")
      .on(t.tableId)
      .where(sql`${t.status} = 'open'`),
    index("table_sessions_restaurant_status_idx").on(t.restaurantId, t.status),
    check("table_sessions_code_format", sql`${t.code} ~ '^[A-Z0-9]{6}$'`),
    check(
      "table_sessions_closed_consistency",
      sql`(${t.status} = 'open' AND ${t.closedAt} IS NULL) OR (${t.status} = 'closed' AND ${t.closedAt} IS NOT NULL)`,
    ),
  ],
);

/** A customer at a table session: a signed-in user or a QR guest — exactly one. */
export const tableSessionMembers = pgTable(
  "table_session_members",
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid()
      .notNull()
      .references(() => tableSessions.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    guestId: uuid().references(() => guests.id, { onDelete: "set null" }),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Set when the customer leaves; kept (not deleted) because orders reference members. */
    leftAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("table_session_members_user_unique")
      .on(t.sessionId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    uniqueIndex("table_session_members_guest_unique")
      .on(t.sessionId, t.guestId)
      .where(sql`${t.guestId} IS NOT NULL`),
    index("table_session_members_session_idx").on(t.sessionId),
    // On insert exactly one identity is set; it may become null later only if
    // the account/guest is deleted (history is kept).
    check(
      "table_session_members_identity",
      sql`NOT (${t.userId} IS NOT NULL AND ${t.guestId} IS NOT NULL)`,
    ),
  ],
);

export type TableSession = typeof tableSessions.$inferSelect;
export type TableSessionMember = typeof tableSessionMembers.$inferSelect;
