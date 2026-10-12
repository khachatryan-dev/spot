import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { EMAIL_STATUSES, NOTIFICATION_TYPES } from "@/shared/constants/notifications";

import { restaurants } from "./restaurants";
import { users } from "./users";

export const notificationType = pgEnum("notification_type", NOTIFICATION_TYPES);
export const emailStatus = pgEnum("email_status", EMAIL_STATUSES);

/**
 * In-app notifications for signed-in people (§27). Stores what happened and
 * its details; the text is translated when shown, in the reader's language.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationType().notNull(),
    restaurantId: uuid().references(() => restaurants.id, { onDelete: "cascade" }),
    /** Values for the message (restaurant name, time…); never secrets. */
    data: jsonb().$type<Record<string, string | number>>().notNull().default({}),
    /** Where tapping it goes (an app path, no locale prefix). */
    link: text(),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_user_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} IS NULL`),
  ],
);

/**
 * Every email the platform sends (§27), written before delivery: what was
 * sent, to whom and what happened. With no email service configured,
 * messages are "logged" instead of sent.
 */
export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    to: text().notNull(),
    template: text().notNull(),
    locale: text().notNull(),
    subject: text().notNull(),
    status: emailStatus().notNull().default("pending"),
    attempts: smallint().notNull().default(0),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("email_messages_status_idx").on(t.status, t.createdAt)],
);

export type Notification = typeof notifications.$inferSelect;
export type EmailMessage = typeof emailMessages.$inferSelect;
