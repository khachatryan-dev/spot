import "server-only";

import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { createTranslator } from "use-intl/core";

import { db } from "@/server/db/client";
import { reservations, restaurantLocations, restaurants } from "@/server/db/schema";
import { type EmailLocale, emailLocale, formatWhen } from "@/server/email/templates";
import { logger } from "@/server/logger";
import { notify, recipientOf, sendEmail, staffWith } from "@/server/services/notification-service";
import { clientEnv } from "@/shared/config/env.client";
import { localDate } from "@/shared/domain/reservation-slots";

import en from "../../../messages/en.json";
import hy from "../../../messages/hy.json";

/*
 * Who hears about a booking (§27), after the change is committed:
 *   request (staff confirm)  → staff in-app; guest "request sent" email
 *   confirmed                → guest in-app + email
 *   declined / cancelled     → guest in-app + email (with the reason)
 *   cancelled by the guest   → staff in-app
 *   deposit paid             → guest in-app, then as a request or confirmation
 *   day-of reminder          → guest email (daily job)
 */

const log = logger.child({ module: "reservation-notices" });

export type ReservationEvent =
  | "created"
  | "confirmed"
  | "declined"
  | "cancelled_by_restaurant"
  | "cancelled_by_guest"
  | "deposit_paid";

const appUrl = (path: string, locale: EmailLocale) =>
  `${clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}${locale === "hy" ? "" : `/${locale}`}${path}`;

const guestsLabel = (count: number, locale: EmailLocale) =>
  createTranslator({ locale, messages: locale === "hy" ? hy : en, namespace: "Reservations" })(
    "guests",
    { count },
  );

async function load(reservationId: string) {
  const [row] = await db
    .select({
      reservation: reservations,
      restaurantName: restaurants.name,
      restaurantSlug: restaurants.slug,
      addressLine: restaurantLocations.addressLine,
      city: restaurantLocations.city,
      timezone: restaurantLocations.timezone,
    })
    .from(reservations)
    .innerJoin(restaurants, eq(restaurants.id, reservations.restaurantId))
    .innerJoin(restaurantLocations, eq(restaurantLocations.id, reservations.locationId))
    .where(eq(reservations.id, reservationId));
  return row ?? null;
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

async function emailGuest(
  row: Loaded,
  template:
    | "reservation_received"
    | "reservation_confirmed"
    | "reservation_declined"
    | "reservation_cancelled"
    | "reservation_reminder",
) {
  const guest = await recipientOf(row.reservation.customerUserId);
  if (!guest) return;
  const locale = emailLocale(guest.preferredLocale);
  const r = row.reservation;
  await sendEmail({
    to: guest.email,
    template,
    locale,
    values: {
      name: r.contactName,
      restaurant: row.restaurantName,
      when: formatWhen(r.startsAt, row.timezone, locale),
      time: new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: row.timezone }).format(
        r.startsAt,
      ),
      party: guestsLabel(r.partySize, locale),
      address: `${row.addressLine}, ${row.city}`,
      ...(r.cancellationReason && { reason: r.cancellationReason }),
    },
    action: {
      url:
        template === "reservation_declined" || template === "reservation_cancelled"
          ? appUrl(`/r/${row.restaurantSlug}`, locale)
          : appUrl("/reservations", locale),
    },
  });
}

function data(row: Loaded) {
  return {
    restaurant: row.restaurantName,
    startsAt: row.reservation.startsAt.toISOString(),
    timezone: row.timezone,
    party: row.reservation.partySize,
    guest: row.reservation.contactName,
  };
}

async function tellStaff(
  row: Loaded,
  type: "reservation_requested" | "reservation_cancelled_by_guest",
) {
  const r = row.reservation;
  await notify(await staffWith(r.restaurantId, "reservation:manage"), {
    type,
    restaurantId: r.restaurantId,
    data: data(row),
    link: `/dashboard/r/${r.restaurantId}/reservations?location=${r.locationId}&date=${localDate(r.startsAt, row.timezone)}`,
  });
}

async function tellGuest(
  row: Loaded,
  type:
    | "reservation_confirmed"
    | "reservation_declined"
    | "reservation_cancelled_by_restaurant"
    | "deposit_paid",
) {
  const r = row.reservation;
  if (!r.customerUserId) return;
  await notify([r.customerUserId], {
    type,
    restaurantId: r.restaurantId,
    data: { ...data(row), ...(r.cancellationReason && { reason: r.cancellationReason }) },
    link: "/reservations",
  });
}

/** Announce a booking change. Never throws (the change already happened). */
export async function announceReservation(event: ReservationEvent, reservationId: string) {
  try {
    await announce(event, reservationId);
  } catch (err) {
    log.error("Reservation announcement failed", { err, event });
  }
}

async function announce(event: ReservationEvent, reservationId: string): Promise<void> {
  const row = await load(reservationId);
  if (!row) return;
  const status = row.reservation.status;
  switch (event) {
    case "created":
      if (status === "pending_confirmation") {
        await tellStaff(row, "reservation_requested");
        await emailGuest(row, "reservation_received");
      } else if (status === "confirmed") {
        await emailGuest(row, "reservation_confirmed");
      }
      return;
    case "deposit_paid":
      await tellGuest(row, "deposit_paid");
      return announce("created", reservationId);
    case "confirmed":
      await tellGuest(row, "reservation_confirmed");
      await emailGuest(row, "reservation_confirmed");
      return;
    case "declined":
      await tellGuest(row, "reservation_declined");
      await emailGuest(row, "reservation_declined");
      return;
    case "cancelled_by_restaurant":
      await tellGuest(row, "reservation_cancelled_by_restaurant");
      await emailGuest(row, "reservation_cancelled");
      return;
    case "cancelled_by_guest":
      await tellStaff(row, "reservation_cancelled_by_guest");
      return;
  }
}

/**
 * Remind guests of today's confirmed bookings (run by the daily job): those
 * starting within the next `hours`, each reminded once.
 */
export async function sendReservationReminders(now = new Date(), hours = 18): Promise<number> {
  const due = await db
    .update(reservations)
    .set({ reminderSentAt: now })
    .where(
      and(
        eq(reservations.status, "confirmed"),
        isNull(reservations.reminderSentAt),
        gt(reservations.startsAt, now),
        lte(reservations.startsAt, new Date(now.getTime() + hours * 3_600_000)),
      ),
    )
    .returning({ id: reservations.id });
  for (const { id } of due) {
    const row = await load(id);
    if (row) await emailGuest(row, "reservation_reminder");
  }
  return due.length;
}
