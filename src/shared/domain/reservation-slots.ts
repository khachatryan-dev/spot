import { type OpeningHours, WEEKDAYS, type Weekday } from "@/shared/schemas/opening-hours";

/*
 * Reservation availability (§20) as pure functions: which start times a
 * location offers on a date, and which of them still have a free table.
 * Dates are the location's local calendar dates ("2026-10-02"); instants are
 * Dates (UTC).
 */

const MINUTE = 60_000;

const toMinutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Offset of `timeZone` from UTC at `at`, in ms (Yerevan: +4h). */
function zoneOffset(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant at `minutes` past local midnight of `date` in `timeZone`.
 * Minutes past 24h roll into the next day (overnight periods).
 */
export function zonedTime(date: string, minutes: number, timeZone: string): Date {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d) + minutes * MINUTE;
  // Two passes settle the offset across a DST change.
  let utc = wall - zoneOffset(new Date(wall), timeZone);
  utc = wall - zoneOffset(new Date(utc), timeZone);
  return new Date(utc);
}

/** The local calendar date of `at` in `timeZone`, as "YYYY-MM-DD". */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Local "HH:MM" of `at` in `timeZone`. */
export function localClock(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

/** "2026-10-02" plus `days` calendar days. */
export function addDays(date: string, days: number): string {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Weekday of a calendar date. */
export function weekdayOf(date: string): Weekday {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  // getUTCDay: 0 = Sunday; WEEKDAYS starts on Monday.
  return WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7]!;
}

export interface SlotRules {
  openingHours: Partial<OpeningHours>;
  timezone: string;
  durationMinutes: number;
  stepMinutes: number;
}

/**
 * Start times offered on `date`: every `stepMinutes` from each opening, as
 * long as the whole reservation fits before that period closes. An overnight
 * period (18:00–02:00) belongs to the day it opens. No opening hours means no
 * reservations: a guest can't book a restaurant that hasn't said when it's open.
 */
export function candidateStarts(date: string, rules: SlotRules): Date[] {
  const periods = rules.openingHours[weekdayOf(date)] ?? [];
  const starts = new Map<number, Date>();
  for (const { open, close } of periods) {
    const from = toMinutes(open);
    let until = toMinutes(close);
    if (until <= from) until += 24 * 60;
    for (let m = from; m + rules.durationMinutes <= until; m += rules.stepMinutes) {
      const at = zonedTime(date, m, rules.timezone);
      starts.set(at.getTime(), at);
    }
  }
  return [...starts.values()].sort((a, b) => a.getTime() - b.getTime());
}

export interface BookingWindow {
  timezone: string;
  minNoticeMinutes: number;
  maxDaysAhead: number;
}

/** Can a reservation starting at `start` (on local `date`) be made at `now`? */
export function isWithinBookingWindow(
  date: string,
  start: Date,
  now: Date,
  window: BookingWindow,
): boolean {
  if (start.getTime() < now.getTime() + window.minNoticeMinutes * MINUTE) return false;
  return date <= addDays(localDate(now, window.timezone), window.maxDaysAhead);
}

export interface SlotTable {
  id: string;
  capacity: number;
}

export interface SlotHold {
  tableId: string;
  startsAt: Date;
  endsAt: Date;
}

/** Holds use half-open ranges [start, end), matching the database constraint. */
const overlaps = (hold: SlotHold, start: Date, end: Date) =>
  hold.startsAt.getTime() < end.getTime() && start.getTime() < hold.endsAt.getTime();

/**
 * Tables big enough for the party and free for [start, end), smallest first
 * so a couple doesn't take the table for eight.
 */
export function freeTables<T extends SlotTable>(
  tables: T[],
  holds: SlotHold[],
  partySize: number,
  start: Date,
  end: Date,
): T[] {
  return tables
    .filter((t) => t.capacity >= partySize)
    .filter((t) => !holds.some((h) => h.tableId === t.id && overlaps(h, start, end)))
    .sort((a, b) => a.capacity - b.capacity);
}
