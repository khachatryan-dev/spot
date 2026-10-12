import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_shared";
import { users } from "./users";

/**
 * Anonymous customers (§25): someone who scanned a QR code without signing in.
 * Identified by a random cookie token; only its SHA-256 hash is stored.
 * When they sign in or sign up, the guest is claimed by their user account.
 */
export const guests = pgTable(
  "guests",
  {
    id: uuid().primaryKey().defaultRandom(),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    claimedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    claimedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("guests_expires_at_idx").on(table.expiresAt),
    index("guests_claimed_by_user_id_idx").on(table.claimedByUserId),
  ],
);

export type Guest = typeof guests.$inferSelect;
