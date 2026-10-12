import { describe, expect, it } from "vitest";

import {
  addDays,
  candidateStarts,
  freeTables,
  isWithinBookingWindow,
  localClock,
  localDate,
  weekdayOf,
  zonedTime,
} from "./reservation-slots";

const YEREVAN = "Asia/Yerevan"; // UTC+4, no DST
const BERLIN = "Europe/Berlin"; // DST: 2026-03-29 and 2026-10-25
const at = (local: string) => new Date(`${local}+04:00`);

describe("calendar helpers", () => {
  it("converts local wall time to an instant in the location's zone", () => {
    expect(zonedTime("2026-10-02", 19 * 60, YEREVAN)).toEqual(new Date("2026-10-02T15:00:00Z"));
    expect(zonedTime("2026-10-02", 25 * 60, YEREVAN)).toEqual(new Date("2026-10-02T21:00:00Z"));
  });

  it("follows daylight saving time", () => {
    expect(zonedTime("2026-07-01", 19 * 60, BERLIN)).toEqual(new Date("2026-07-01T17:00:00Z"));
    expect(zonedTime("2026-12-01", 19 * 60, BERLIN)).toEqual(new Date("2026-12-01T18:00:00Z"));
    // The night clocks go back: 19:00 is already winter time.
    expect(zonedTime("2026-10-25", 19 * 60, BERLIN)).toEqual(new Date("2026-10-25T18:00:00Z"));
  });

  it("reads local date and clock, and walks the calendar", () => {
    const lateEvening = new Date("2026-10-02T21:30:00Z"); // 01:30 Saturday in Yerevan
    expect(localDate(lateEvening, YEREVAN)).toBe("2026-10-03");
    expect(localClock(lateEvening, YEREVAN)).toBe("01:30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(weekdayOf("2026-10-02")).toBe("fri");
    expect(weekdayOf("2026-10-04")).toBe("sun");
  });
});

describe("candidateStarts", () => {
  const rules = {
    openingHours: {
      fri: [
        { open: "12:00", close: "15:00" },
        { open: "18:00", close: "02:00" },
      ],
      sat: [{ open: "10:00", close: "11:00" }],
    },
    timezone: YEREVAN,
    durationMinutes: 120,
    stepMinutes: 30,
  };
  const clocks = (date: string, r = rules) =>
    candidateStarts(date, r).map((d) => localClock(d, YEREVAN));

  it("offers every step from opening while the whole booking fits before closing", () => {
    expect(clocks("2026-10-02")).toEqual([
      "12:00",
      "12:30",
      "13:00", // 13:00–15:00 is the last lunch slot
      "18:00",
      "18:30",
      "19:00",
      "19:30",
      "20:00",
      "20:30",
      "21:00",
      "21:30",
      "22:00",
      "22:30",
      "23:00",
      "23:30",
      "00:00", // ends at 02:00 closing; part of Friday night
    ]);
  });

  it("offers nothing when the opening is shorter than a booking, or the day is closed", () => {
    expect(clocks("2026-10-03")).toEqual([]); // Saturday: 1 hour open, 2-hour bookings
    expect(clocks("2026-10-04")).toEqual([]); // Sunday: closed
    expect(candidateStarts("2026-10-02", { ...rules, openingHours: {} })).toEqual([]);
  });

  it("puts after-midnight starts on the next calendar day", () => {
    const last = candidateStarts("2026-10-02", rules).at(-1)!;
    expect(localDate(last, YEREVAN)).toBe("2026-10-03");
  });

  it("respects a different step and duration", () => {
    expect(clocks("2026-10-03", { ...rules, durationMinutes: 30, stepMinutes: 15 })).toEqual([
      "10:00",
      "10:15",
      "10:30",
    ]);
  });
});

describe("isWithinBookingWindow", () => {
  const window = { timezone: YEREVAN, minNoticeMinutes: 60, maxDaysAhead: 30 };
  const now = at("2026-10-02T17:00:00");

  it("needs the minimum notice", () => {
    expect(isWithinBookingWindow("2026-10-02", at("2026-10-02T17:59:00"), now, window)).toBe(false);
    expect(isWithinBookingWindow("2026-10-02", at("2026-10-02T18:00:00"), now, window)).toBe(true);
    expect(
      isWithinBookingWindow("2026-10-02", at("2026-10-02T17:30:00"), now, {
        ...window,
        minNoticeMinutes: 0,
      }),
    ).toBe(true);
  });

  it("refuses the past and dates beyond the limit", () => {
    expect(isWithinBookingWindow("2026-10-01", at("2026-10-01T19:00:00"), now, window)).toBe(false);
    expect(isWithinBookingWindow("2026-11-01", at("2026-11-01T19:00:00"), now, window)).toBe(true);
    expect(isWithinBookingWindow("2026-11-02", at("2026-11-02T19:00:00"), now, window)).toBe(false);
  });
});

describe("freeTables", () => {
  const tables = [
    { id: "eight", capacity: 8 },
    { id: "two", capacity: 2 },
    { id: "four", capacity: 4 },
  ];
  const start = at("2026-10-02T19:00:00");
  const end = at("2026-10-02T21:00:00");
  const hold = (tableId: string, from: string, to: string) => ({
    tableId,
    startsAt: at(`2026-10-02T${from}:00`),
    endsAt: at(`2026-10-02T${to}:00`),
  });

  it("returns tables that fit the party, smallest first", () => {
    expect(freeTables(tables, [], 2, start, end).map((t) => t.id)).toEqual([
      "two",
      "four",
      "eight",
    ]);
    expect(freeTables(tables, [], 5, start, end).map((t) => t.id)).toEqual(["eight"]);
    expect(freeTables(tables, [], 9, start, end)).toEqual([]);
  });

  it("skips tables held for an overlapping time, but not back-to-back ones", () => {
    const holds = [hold("two", "18:00", "19:30"), hold("four", "21:00", "23:00")];
    expect(freeTables(tables, holds, 2, start, end).map((t) => t.id)).toEqual(["four", "eight"]);
  });
});
