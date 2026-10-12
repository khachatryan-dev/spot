import { bigint, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_shared";
import { users } from "./users";

/**
 * Tables owned by Better Auth (sessions, linked logins, verification tokens,
 * rate-limit counters). Column names follow its schema; don't rename them.
 */

/** Database sessions: revocable at any time (logout, suspension). */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Opaque value stored in the session cookie. */
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    ...timestamps,
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

/**
 * How a user signs in: one row per method. `providerId = "credential"` holds
 * the password hash; OAuth providers (Google, Day 10) hold their tokens.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

/** Short-lived tokens: email verification, password reset. */
export const verifications = pgTable(
  "verifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

/** Auth rate-limit counters, shared across server instances. */
export const rateLimits = pgTable("rate_limits", {
  id: uuid().primaryKey().defaultRandom(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: "number" }).notNull(),
});
