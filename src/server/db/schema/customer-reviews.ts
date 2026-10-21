import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { MAX_CUSTOMER_REVIEW_COMMENT } from "@/shared/constants/customer-reviews";

import { timestamps } from "./_shared";
import { reservations } from "./reservations";
import { restaurants } from "./restaurants";
import { reviewSubject } from "./reviews";
import { tableSessions } from "./table-sessions";
import { users } from "./users";

/**
 * A restaurant's rating of a signed-in customer after a real visit: a
 * completed or no-show reservation, or an ended table visit where they
 * ordered. Seen only by that restaurant's team and by the customer.
 * One rating per reservation, and per customer per visit; editable.
 */
export const customerReviews = pgTable(
  "customer_reviews",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    subject: reviewSubject().notNull(),
    reservationId: uuid(),
    tableSessionId: uuid(),
    customerUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: smallint().notNull(),
    comment: text(),
    /** Staff member who wrote or last changed it. */
    authorUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "customer_reviews_reservation_fk",
      columns: [t.reservationId, t.restaurantId],
      foreignColumns: [reservations.id, reservations.restaurantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "customer_reviews_session_fk",
      columns: [t.tableSessionId, t.restaurantId],
      foreignColumns: [tableSessions.id, tableSessions.restaurantId],
    }).onDelete("cascade"),
    uniqueIndex("customer_reviews_one_per_reservation")
      .on(t.reservationId)
      .where(sql`${t.reservationId} IS NOT NULL`),
    uniqueIndex("customer_reviews_one_per_visit_customer")
      .on(t.tableSessionId, t.customerUserId)
      .where(sql`${t.tableSessionId} IS NOT NULL`),
    index("customer_reviews_restaurant_customer_idx").on(t.restaurantId, t.customerUserId),
    index("customer_reviews_customer_idx").on(t.customerUserId, t.createdAt),
    check("customer_reviews_rating", sql`${t.rating} BETWEEN 1 AND 5`),
    check(
      "customer_reviews_comment_length",
      sql`${t.comment} IS NULL OR length(${t.comment}) <= ${sql.raw(String(MAX_CUSTOMER_REVIEW_COMMENT))}`,
    ),
    check(
      "customer_reviews_subject_target",
      sql`(${t.subject} = 'reservation' AND ${t.reservationId} IS NOT NULL AND ${t.tableSessionId} IS NULL)
        OR (${t.subject} = 'visit' AND ${t.tableSessionId} IS NOT NULL AND ${t.reservationId} IS NULL)`,
    ),
  ],
);

export type CustomerReview = typeof customerReviews.$inferSelect;
