import { timestamp } from "drizzle-orm/pg-core";

/** `created_at` / `updated_at` columns for every mutable table. */
export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
