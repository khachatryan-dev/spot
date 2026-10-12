import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { MAX_REVIEW_COMMENT, REVIEW_STATUSES, REVIEW_SUBJECTS } from "@/shared/constants/reviews";

import { timestamps } from "./_shared";
import { guests } from "./guests";
import { reservations } from "./reservations";
import { restaurantLocations, restaurants } from "./restaurants";
import { tableSessions } from "./table-sessions";
import { users } from "./users";

export const reviewStatus = pgEnum("review_status", REVIEW_STATUSES);
export const reviewSubject = pgEnum("review_subject", REVIEW_SUBJECTS);

/**
 * A verified review (§24): always tied to a real completed reservation or
 * table visit of its author — never written from nothing. One review per
 * author per reservation or visit. Authors are signed-in users, or
 * anonymous guests who leave an email address.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    locationId: uuid().notNull(),
    subject: reviewSubject().notNull(),
    reservationId: uuid(),
    tableSessionId: uuid(),
    authorUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    authorGuestId: uuid().references(() => guests.id, { onDelete: "set null" }),
    /** Anonymous guests must leave an email (stored lowercase, never shown publicly). */
    authorEmail: text(),
    /** An anonymous author confirmed their email through the link we sent. */
    authorEmailVerifiedAt: timestamp({ withTimezone: true }),
    /** Hash of that link's token (the token itself is only in the email). */
    emailTokenHash: text(),
    /** Shown with the review: the account's name or what the guest typed. */
    displayName: text().notNull(),
    rating: smallint().notNull(),
    comment: text(),
    status: reviewStatus().notNull().default("published"),
    publishedAt: timestamp({ withTimezone: true }),
    /** Admin moderation (Phase 11, part 4). */
    moderatedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    moderatedAt: timestamp({ withTimezone: true }),
    moderationReason: text(),
    /** The restaurant's public reply (Phase 11, part 3). */
    response: text(),
    respondedAt: timestamp({ withTimezone: true }),
    respondedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    /** The restaurant reported the review for moderation (it stays visible meanwhile). */
    reportedAt: timestamp({ withTimezone: true }),
    reportedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    reportReason: text(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "reviews_location_fk",
      columns: [t.locationId, t.restaurantId],
      foreignColumns: [restaurantLocations.id, restaurantLocations.restaurantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "reviews_reservation_fk",
      columns: [t.reservationId, t.restaurantId],
      foreignColumns: [reservations.id, reservations.restaurantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "reviews_session_fk",
      columns: [t.tableSessionId, t.restaurantId],
      foreignColumns: [tableSessions.id, tableSessions.restaurantId],
    }).onDelete("cascade"),
    // One review per reservation (it has one guest)…
    uniqueIndex("reviews_one_per_reservation")
      .on(t.reservationId)
      .where(sql`${t.reservationId} IS NOT NULL`),
    // …and one per author per visit.
    uniqueIndex("reviews_one_per_visit_user")
      .on(t.tableSessionId, t.authorUserId)
      .where(sql`${t.tableSessionId} IS NOT NULL AND ${t.authorUserId} IS NOT NULL`),
    uniqueIndex("reviews_one_per_visit_guest")
      .on(t.tableSessionId, t.authorGuestId)
      .where(sql`${t.tableSessionId} IS NOT NULL AND ${t.authorGuestId} IS NOT NULL`),
    index("reviews_restaurant_status_idx").on(t.restaurantId, t.status, t.createdAt),
    index("reviews_reported_idx")
      .on(t.reportedAt)
      .where(sql`${t.reportedAt} IS NOT NULL AND ${t.moderatedAt} IS NULL`),
    check("reviews_rating", sql`${t.rating} BETWEEN 1 AND 5`),
    check(
      "reviews_comment_length",
      sql`${t.comment} IS NULL OR length(${t.comment}) <= ${sql.raw(String(MAX_REVIEW_COMMENT))}`,
    ),
    check(
      "reviews_subject_target",
      sql`(${t.subject} = 'reservation' AND ${t.reservationId} IS NOT NULL AND ${t.tableSessionId} IS NULL)
        OR (${t.subject} = 'visit' AND ${t.tableSessionId} IS NOT NULL AND ${t.reservationId} IS NULL)`,
    ),
    // One kind of author (both become null if the account or guest is deleted).
    check(
      "reviews_author",
      sql`NOT (${t.authorUserId} IS NOT NULL AND ${t.authorGuestId} IS NOT NULL)`,
    ),
    check("reviews_guest_email", sql`${t.authorGuestId} IS NULL OR ${t.authorEmail} IS NOT NULL`),
    check(
      "reviews_email_lowercase",
      sql`${t.authorEmail} IS NULL OR ${t.authorEmail} = lower(${t.authorEmail})`,
    ),
    check(
      "reviews_report_reason",
      sql`${t.reportedAt} IS NULL OR length(trim(${t.reportReason})) BETWEEN 10 AND 500`,
    ),
    check("reviews_display_name", sql`length(trim(${t.displayName})) BETWEEN 1 AND 60`),
    check(
      "reviews_response_length",
      sql`${t.response} IS NULL OR length(${t.response}) <= ${sql.raw(String(MAX_REVIEW_COMMENT))}`,
    ),
  ],
);

export type Review = typeof reviews.$inferSelect;
