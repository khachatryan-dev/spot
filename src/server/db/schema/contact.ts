import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { CONTACT_STATUSES, CONTACT_TOPICS } from "@/shared/constants/contact";

import { users } from "./users";

export const contactTopic = pgEnum("contact_topic", CONTACT_TOPICS);
export const contactStatus = pgEnum("contact_status", CONTACT_STATUSES);

/** Messages from the public contact form, read by platform admins. */
export const contactMessages = pgTable(
  "contact_messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    email: text().notNull(),
    topic: contactTopic().notNull(),
    message: text().notNull(),
    locale: text().notNull(),
    /** Set when the sender was signed in. */
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    status: contactStatus().notNull().default("new"),
    handledAt: timestamp({ withTimezone: true }),
    handledByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contact_messages_status_created_idx").on(t.status, t.createdAt)],
);

export type ContactMessage = typeof contactMessages.$inferSelect;
