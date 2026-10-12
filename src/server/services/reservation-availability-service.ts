import "server-only";

import { and, eq, gt, inArray, isNull, lt, notInArray, or } from "drizzle-orm";
import { z } from "zod";

import { db, type Executor } from "@/server/db/client";
import {
  diningTables,
  reservationHolds,
  restaurantLocations,
  restaurants,
} from "@/server/db/schema";
import { RESERVATION_SLOT_STEP_MINUTES } from "@/shared/constants/reservations";
import { isPubliclyVisible } from "@/shared/domain/restaurant-status";
import {
  candidateStarts,
  freeTables,
  isWithinBookingWindow,
  localClock,
  type SlotHold,
  type SlotTable,
} from "@/shared/domain/reservation-slots";
import { AppError } from "@/shared/errors";
import { type AvailabilityQuery, availabilityQuerySchema } from "@/shared/schemas/reservation";

/*
 * Reservation availability (§20): a time is offered only if a table that
 * fits the party is free for the whole booking, inside opening hours and the
 * location's booking window. The same loaders are used when placing a hold,
 * inside its transaction, so what guests see matches what can be booked.
 */

/** Tables that can never be booked, whatever the time. */
const UNBOOKABLE_STATUSES = ["blocked", "out_of_service"] as const;

/** A location's booking rules, if it's public and takes reservations. */
export async function loadBookableLocation(
  executor: Executor,
  restaurantId: string,
  locationId: string,
) {
  if (!z.uuid().safeParse(restaurantId).success || !z.uuid().safeParse(locationId).success) {
    return null;
  }
  const [row] = await executor
    .select({
      id: restaurantLocations.id,
      restaurantId: restaurantLocations.restaurantId,
      restaurantStatus: restaurants.status,
      status: restaurantLocations.status,
      timezone: restaurantLocations.timezone,
      openingHours: restaurantLocations.openingHours,
      reservationsEnabled: restaurantLocations.reservationsEnabled,
      confirmation: restaurantLocations.reservationConfirmation,
      depositType: restaurantLocations.reservationDepositType,
      depositMinor: restaurantLocations.reservationDepositMinor,
      currency: restaurants.currency,
      durationMinutes: restaurantLocations.reservationDurationMinutes,
      minNoticeMinutes: restaurantLocations.reservationMinNoticeMinutes,
      maxDaysAhead: restaurantLocations.reservationMaxDaysAhead,
    })
    .from(restaurantLocations)
    .innerJoin(restaurants, eq(restaurants.id, restaurantLocations.restaurantId))
    .where(
      and(
        eq(restaurantLocations.id, locationId),
        eq(restaurantLocations.restaurantId, restaurantId),
      ),
    );
  if (!row || !isPubliclyVisible(row.restaurantStatus) || row.status !== "active") return null;
  return row;
}

export type BookableLocation = NonNullable<Awaited<ReturnType<typeof loadBookableLocation>>>;

/** Active tables at the location that can take reservations. */
export function loadBookableTables(executor: Executor, locationId: string): Promise<SlotTable[]> {
  return executor
    .select({ id: diningTables.id, capacity: diningTables.capacity })
    .from(diningTables)
    .where(
      and(
        eq(diningTables.locationId, locationId),
        eq(diningTables.isActive, true),
        notInArray(diningTables.status, [...UNBOOKABLE_STATUSES]),
      ),
    );
}

/**
 * Holds on these tables that still count at `now` and overlap [from, to).
 * An expired hold no longer blocks anyone, even before it's released.
 */
export function loadLiveHolds(
  executor: Executor,
  tableIds: string[],
  from: Date,
  to: Date,
  now: Date,
): Promise<SlotHold[]> {
  if (tableIds.length === 0) return Promise.resolve([]);
  return executor
    .select({
      tableId: reservationHolds.tableId,
      startsAt: reservationHolds.startsAt,
      endsAt: reservationHolds.endsAt,
    })
    .from(reservationHolds)
    .where(
      and(
        inArray(reservationHolds.tableId, tableIds),
        isNull(reservationHolds.releasedAt),
        or(isNull(reservationHolds.expiresAt), gt(reservationHolds.expiresAt, now)),
        lt(reservationHolds.startsAt, to),
        gt(reservationHolds.endsAt, from),
      ),
    );
}

export interface ReservationSlot {
  startsAt: Date;
  /** Local "HH:MM" at the location. */
  time: string;
}

export type ReservationAvailability =
  | { available: false; reason: "disabled" }
  | { available: true; timezone: string; durationMinutes: number; slots: ReservationSlot[] };

/**
 * Times a party can book at a public location on a local date. Throws
 * NOT_FOUND for unknown or non-public locations; returns `disabled` when the
 * location doesn't take reservations.
 */
export async function getReservationAvailability(
  restaurantId: string,
  locationId: string,
  query: AvailabilityQuery,
  now = new Date(),
): Promise<ReservationAvailability> {
  const { date, partySize } = availabilityQuerySchema.parse(query);
  const location = await loadBookableLocation(db, restaurantId, locationId);
  if (!location) throw new AppError("NOT_FOUND", "Restaurant not found.");
  if (!location.reservationsEnabled) return { available: false, reason: "disabled" };

  const result = {
    available: true as const,
    timezone: location.timezone,
    durationMinutes: location.durationMinutes,
  };
  const starts = candidateStarts(date, {
    openingHours: location.openingHours,
    timezone: location.timezone,
    durationMinutes: location.durationMinutes,
    stepMinutes: RESERVATION_SLOT_STEP_MINUTES,
  }).filter((start) => isWithinBookingWindow(date, start, now, location));
  if (starts.length === 0) return { ...result, slots: [] };

  const tables = (await loadBookableTables(db, location.id)).filter((t) => t.capacity >= partySize);
  const duration = location.durationMinutes * 60_000;
  const holds = await loadLiveHolds(
    db,
    tables.map((t) => t.id),
    starts[0]!,
    new Date(starts.at(-1)!.getTime() + duration),
    now,
  );

  const slots = starts
    .filter((start) => {
      const end = new Date(start.getTime() + duration);
      return freeTables(tables, holds, partySize, start, end).length > 0;
    })
    .map((startsAt) => ({ startsAt, time: localClock(startsAt, location.timezone) }));
  return { ...result, slots };
}

/** The public booking page's location, by its URL slugs; null if not public. */
export async function findBookingLocation(restaurantSlug: string, locationSlug: string) {
  const [row] = await db
    .select({
      restaurantId: restaurants.id,
      restaurantName: restaurants.name,
      restaurantStatus: restaurants.status,
      locationId: restaurantLocations.id,
      locationName: restaurantLocations.name,
      locationStatus: restaurantLocations.status,
      addressLine: restaurantLocations.addressLine,
      city: restaurantLocations.city,
      timezone: restaurantLocations.timezone,
      reservationsEnabled: restaurantLocations.reservationsEnabled,
      confirmation: restaurantLocations.reservationConfirmation,
      maxDaysAhead: restaurantLocations.reservationMaxDaysAhead,
      depositType: restaurantLocations.reservationDepositType,
      depositMinor: restaurantLocations.reservationDepositMinor,
      refundCutoffHours: restaurantLocations.reservationRefundCutoffHours,
      currency: restaurants.currency,
    })
    .from(restaurantLocations)
    .innerJoin(restaurants, eq(restaurants.id, restaurantLocations.restaurantId))
    .where(and(eq(restaurants.slug, restaurantSlug), eq(restaurantLocations.slug, locationSlug)));
  if (!row || !isPubliclyVisible(row.restaurantStatus) || row.locationStatus !== "active") {
    return null;
  }
  return row;
}
