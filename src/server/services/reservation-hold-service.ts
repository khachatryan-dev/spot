import "server-only";

import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import type { SessionUser } from "@/server/auth/session";
import { db, type Executor } from "@/server/db/client";
import { isExclusionViolation } from "@/server/db/errors";
import { diningTables, reservationHolds, reservations } from "@/server/db/schema";
import { publishReservationEvent } from "@/server/events/reservation-events";
import { hitRateLimit } from "@/server/rate-limit/rate-limit";
import {
  RESERVATION_HOLD_MINUTES,
  RESERVATION_SLOT_STEP_MINUTES,
} from "@/shared/constants/reservations";
import {
  addDays,
  candidateStarts,
  freeTables,
  isWithinBookingWindow,
  localDate,
} from "@/shared/domain/reservation-slots";
import { AppError } from "@/shared/errors";
import { partySizeSchema } from "@/shared/schemas/reservation";

import {
  type BookableLocation,
  loadBookableLocation,
  loadBookableTables,
  loadLiveHolds,
} from "./reservation-availability-service";

/*
 * Temporary holds (§19): picking a time claims the smallest free table for
 * a few minutes while the guest finishes booking. Bookings at one location
 * run one at a time (an advisory lock), so the read-then-insert is
 * consistent; the exclusion constraint on reservation_holds stays the final
 * word on double booking for anything that skips the lock.
 */

type Actor = Pick<SessionUser, "id">;

export const HOLD_LIMIT = { max: 20, windowMs: 10 * 60_000 };

const holdInputSchema = z.object({
  restaurantId: z.uuid(),
  locationId: z.uuid(),
  startsAt: z.coerce.date(),
  partySize: partySizeSchema,
});

export type HoldInput = z.input<typeof holdInputSchema>;

export interface PlacedHold {
  id: string;
  tableId: string;
  startsAt: Date;
  endsAt: Date;
  expiresAt: Date;
}

/** Which expired holds to release: around a slot, at a location, a guest's, or all. */
export type ExpiryScope =
  | { tableIds: string[]; from: Date; to: Date }
  | { locationId: string }
  | { customerUserId: string };

export interface ExpiryResult {
  holdIds: string[];
  /** Reservations that expired with their hold (for notifying staff screens). */
  expired: { id: string; restaurantId: string; locationId: string }[];
}

function scopeFilter(scope: ExpiryScope): SQL | undefined {
  if ("tableIds" in scope) {
    return and(
      inArray(reservationHolds.tableId, scope.tableIds),
      lt(reservationHolds.startsAt, scope.to),
      gt(reservationHolds.endsAt, scope.from),
    );
  }
  if ("locationId" in scope) {
    return inArray(
      reservationHolds.tableId,
      db
        .select({ id: diningTables.id })
        .from(diningTables)
        .where(eq(diningTables.locationId, scope.locationId)),
    );
  }
  return inArray(
    reservationHolds.reservationId,
    db
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.customerUserId, scope.customerUserId)),
  );
}

/**
 * Release holds whose time ran out (within `scope`, or everywhere). A
 * reservation still waiting on such a hold expires with it.
 */
export async function releaseExpiredHolds(
  executor: Executor,
  now: Date,
  scope?: ExpiryScope,
): Promise<ExpiryResult> {
  if (scope && "tableIds" in scope && scope.tableIds.length === 0) {
    return { holdIds: [], expired: [] };
  }
  const released = await executor
    .update(reservationHolds)
    .set({ releasedAt: now })
    .where(
      and(
        isNull(reservationHolds.releasedAt),
        isNotNull(reservationHolds.expiresAt),
        lte(reservationHolds.expiresAt, now),
        scope && scopeFilter(scope),
      ),
    )
    .returning({ id: reservationHolds.id, reservationId: reservationHolds.reservationId });

  const reservationIds = released.flatMap((h) => (h.reservationId ? [h.reservationId] : []));
  const expired =
    reservationIds.length === 0
      ? []
      : await executor
          .update(reservations)
          .set({ status: "expired", expiredAt: now })
          .where(
            and(
              inArray(reservations.id, reservationIds),
              inArray(reservations.status, ["pending_payment", "pending_confirmation"]),
            ),
          )
          .returning({
            id: reservations.id,
            restaurantId: reservations.restaurantId,
            locationId: reservations.locationId,
          });
  return { holdIds: released.map((h) => h.id), expired };
}

/**
 * Expire overdue holds and requests, then tell the affected staff screens.
 * Runs on page loads (so screens never show a stale "awaiting confirmation")
 * and from the scheduled job (/api/cron/reservations).
 */
export async function expireOverdueReservations(
  scope?: ExpiryScope,
  now = new Date(),
): Promise<ExpiryResult> {
  const result = await releaseExpiredHolds(db, now, scope);
  for (const reservation of result.expired) {
    await publishReservationEvent({
      type: "RESERVATION_STATUS_CHANGED",
      restaurantId: reservation.restaurantId,
      locationId: reservation.locationId,
      reservationId: reservation.id,
      status: "expired",
    });
  }
  return result;
}

/**
 * Serialize bookings at a location until the transaction ends. Without it,
 * two concurrent inserts on the same table can deadlock on the exclusion
 * constraint instead of one cleanly losing.
 */
export async function lockLocationForBooking(executor: Executor, locationId: string) {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reservations:${locationId}`}, 0))`,
  );
}

/** Is `start` one of the times this location offers, bookable at `now`? */
function isOfferedStart(location: BookableLocation, start: Date, now: Date): boolean {
  const rules = {
    openingHours: location.openingHours,
    timezone: location.timezone,
    durationMinutes: location.durationMinutes,
    stepMinutes: RESERVATION_SLOT_STEP_MINUTES,
  };
  // An after-midnight start belongs to the previous day's overnight period.
  const date = localDate(start, location.timezone);
  return [date, addDays(date, -1)].some(
    (day) =>
      candidateStarts(day, rules).some((s) => s.getTime() === start.getTime()) &&
      isWithinBookingWindow(day, start, now, location),
  );
}

/**
 * Hold a table for a guest's chosen time. Replaces the guest's previous
 * unfinished hold. Throws RESERVATION_UNAVAILABLE if no fitting table is
 * free (including when another guest got the last one first).
 */
export async function placeReservationHold(
  actor: Actor,
  input: HoldInput,
  now = new Date(),
): Promise<PlacedHold> {
  const { restaurantId, locationId, startsAt, partySize } = holdInputSchema.parse(input);
  if (!(await hitRateLimit(`reservation-hold:${actor.id}`, HOLD_LIMIT)).allowed) {
    throw new AppError("RATE_LIMITED");
  }

  const location = await loadBookableLocation(db, restaurantId, locationId);
  if (!location) throw new AppError("NOT_FOUND", "Restaurant not found.");
  if (!location.reservationsEnabled) {
    throw new AppError("RESERVATION_UNAVAILABLE", "This location doesn't take reservations.");
  }
  if (!isOfferedStart(location, startsAt, now)) throw new AppError("RESERVATION_UNAVAILABLE");

  const endsAt = new Date(startsAt.getTime() + location.durationMinutes * 60_000);
  const expiresAt = new Date(now.getTime() + RESERVATION_HOLD_MINUTES * 60_000);

  return db.transaction(async (tx) => {
    await lockLocationForBooking(tx, location.id);
    await releaseGuestHolds(tx, actor.id, now);

    const tables = (await loadBookableTables(tx, location.id)).filter(
      (t) => t.capacity >= partySize,
    );
    const tableIds = tables.map((t) => t.id);
    await releaseExpiredHolds(tx, now, { tableIds, from: startsAt, to: endsAt });
    const holds = await loadLiveHolds(tx, tableIds, startsAt, endsAt, now);

    // Under the lock nobody else books here, but a staff block written
    // without it could still collide: then try the next table (savepoint per try).
    for (const table of freeTables(tables, holds, partySize, startsAt, endsAt)) {
      try {
        const [hold] = await tx.transaction((attempt) =>
          attempt
            .insert(reservationHolds)
            .values({
              restaurantId,
              tableId: table.id,
              createdByUserId: actor.id,
              partySize,
              startsAt,
              endsAt,
              expiresAt,
            })
            .returning(),
        );
        return {
          id: hold!.id,
          tableId: hold!.tableId,
          startsAt: hold!.startsAt,
          endsAt: hold!.endsAt,
          expiresAt: hold!.expiresAt!,
        };
      } catch (error) {
        if (!isExclusionViolation(error, "reservation_holds_no_overlap")) throw error;
      }
    }
    throw new AppError("RESERVATION_UNAVAILABLE");
  });
}

/** A guest's unfinished holds: theirs, not yet part of a reservation, and temporary. */
const guestHoldsOf = (userId: string) =>
  and(
    eq(reservationHolds.createdByUserId, userId),
    isNull(reservationHolds.reservationId),
    isNull(reservationHolds.releasedAt),
    isNotNull(reservationHolds.expiresAt),
  );

function releaseGuestHolds(executor: Executor, userId: string, now: Date) {
  return executor.update(reservationHolds).set({ releasedAt: now }).where(guestHoldsOf(userId));
}

/** The guest changed their mind: give their held table back now. */
export async function releaseReservationHold(actor: Actor, holdId: string) {
  if (!z.uuid().safeParse(holdId).success) return;
  await db
    .update(reservationHolds)
    .set({ releasedAt: new Date() })
    .where(and(eq(reservationHolds.id, holdId), guestHoldsOf(actor.id)));
}

/** A guest's hold that is still live at `now`, for turning into a reservation. */
export async function getLiveGuestHold(
  executor: Executor,
  userId: string,
  holdId: string,
  now: Date,
) {
  if (!z.uuid().safeParse(holdId).success) return null;
  const [hold] = await executor
    .select()
    .from(reservationHolds)
    .where(
      and(
        eq(reservationHolds.id, holdId),
        guestHoldsOf(userId),
        gt(reservationHolds.expiresAt, now),
      ),
    )
    .for("update");
  return hold ?? null;
}
