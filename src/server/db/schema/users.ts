import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { timestamps } from "./_shared";
import { platformRole, userStatus } from "./roles";

/**
 * People with an account. `name`, `email`, `emailVerified` and `image` follow
 * Better Auth's user model; passwords live in `accounts` (see auth.ts).
 * QR guests don't need a row here (Day 11).
 */
export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text(),
    /** Stored lowercase; uniqueness is enforced case-insensitively below. */
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    /** E.164 format, e.g. +37491234567. */
    phone: text(),
    preferredLocale: text(),
    platformRole: platformRole().notNull().default("customer"),
    status: userStatus().notNull().default("active"),
    lastLoginAt: timestamp({ withTimezone: true }),
    /** Why and when a platform admin suspended the account (cleared on restore). */
    suspendedAt: timestamp({ withTimezone: true }),
    suspensionReason: text(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`),
    uniqueIndex("users_phone_unique").on(table.phone),
    index("users_platform_role_idx").on(table.platformRole),
    check("users_email_lowercase", sql`${table.email} = lower(${table.email})`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
