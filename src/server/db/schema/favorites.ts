import { index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";

import { restaurants } from "./restaurants";
import { users } from "./users";

/** Restaurants a signed-in guest saved (§25). */
export const favorites = pgTable(
  "favorites",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "favorites_pk", columns: [t.userId, t.restaurantId] }),
    index("favorites_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export type Favorite = typeof favorites.$inferSelect;
