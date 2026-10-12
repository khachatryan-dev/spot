import { describe, expect, it } from "vitest";

import { isMenuAvailable, isOpenAt, itemUnavailableReason, localTime } from "./availability";

const YEREVAN = "Asia/Yerevan"; // UTC+4, no DST
/** A moment given in Yerevan local time. 2026-10-02 is a Friday. */
const at = (local: string) => new Date(`${local}+04:00`);

const hours = {
  mon: [{ open: "09:00", close: "22:00" }],
  fri: [
    { open: "12:00", close: "15:00" },
    { open: "18:00", close: "02:00" },
  ],
};

describe("localTime", () => {
  it("uses the location's time zone, not the server's", () => {
    expect(localTime(new Date("2026-10-02T20:30:00Z"), YEREVAN)).toEqual({
      day: "sat",
      minutes: 30,
    });
    expect(localTime(new Date("2026-10-02T20:30:00Z"), "Europe/London")).toEqual({
      day: "fri",
      minutes: 21 * 60 + 30,
    });
  });
});

describe("isOpenAt", () => {
  it.each([
    ["Friday 12:00 (lunch opens)", "2026-10-02T12:00:00", true],
    ["Friday 14:59", "2026-10-02T14:59:00", true],
    ["Friday 15:00 (lunch closed)", "2026-10-02T15:00:00", false],
    ["Friday 16:30 (between periods)", "2026-10-02T16:30:00", false],
    ["Friday 23:00 (overnight period)", "2026-10-02T23:00:00", true],
    ["Saturday 01:59 (still Friday night)", "2026-10-03T01:59:00", true],
    ["Saturday 02:00 (closed)", "2026-10-03T02:00:00", false],
    ["Saturday 13:00 (closed all day)", "2026-10-03T13:00:00", false],
    ["Monday 08:59", "2026-10-05T08:59:00", false],
    ["Monday 21:59", "2026-10-05T21:59:00", true],
    ["Tuesday 01:00 (Monday isn't overnight)", "2026-10-06T01:00:00", false],
  ])("%s → %s", (_, local, expected) => {
    expect(isOpenAt(hours, YEREVAN, at(local))).toBe(expected);
  });

  it("treats a missing schedule as closed", () => {
    expect(isOpenAt({}, YEREVAN, at("2026-10-02T12:00:00"))).toBe(false);
  });
});

describe("isMenuAvailable", () => {
  const location = {
    openingHours: { fri: [{ open: "08:00", close: "23:00" }] },
    timezone: YEREVAN,
    status: "active" as const,
  };
  const breakfast = {
    isActive: true,
    availableHours: { fri: [{ open: "08:00", close: "12:00" }] },
  };

  it("follows the location's hours when the menu has none", () => {
    const allDay = { isActive: true, availableHours: null };
    expect(isMenuAvailable({ location, menu: allDay, at: at("2026-10-02T20:00:00") })).toBe(true);
    expect(isMenuAvailable({ location, menu: allDay, at: at("2026-10-02T23:30:00") })).toBe(false);
  });

  it("limits a breakfast menu to its own hours", () => {
    expect(isMenuAvailable({ location, menu: breakfast, at: at("2026-10-02T09:00:00") })).toBe(
      true,
    );
    expect(isMenuAvailable({ location, menu: breakfast, at: at("2026-10-02T13:00:00") })).toBe(
      false,
    );
  });

  it("doesn't restrict menus while the location has no opening hours configured", () => {
    const unconfigured = { ...location, openingHours: { mon: [], tue: [] } };
    const allDay = { isActive: true, availableHours: null };
    expect(
      isMenuAvailable({ location: unconfigured, menu: allDay, at: at("2026-10-03T03:00:00") }),
    ).toBe(true);
    // The menu's own hours still apply.
    expect(
      isMenuAvailable({ location: unconfigured, menu: breakfast, at: at("2026-10-02T13:00:00") }),
    ).toBe(false);
  });

  it("never serves inactive menus or inactive locations", () => {
    const now = at("2026-10-02T09:00:00");
    expect(isMenuAvailable({ location, menu: { ...breakfast, isActive: false }, at: now })).toBe(
      false,
    );
    expect(
      isMenuAvailable({ location: { ...location, status: "inactive" }, menu: breakfast, at: now }),
    ).toBe(false);
  });
});

describe("itemUnavailableReason", () => {
  const ok = {
    category: { isActive: true },
    item: { isActive: true, isAvailable: true },
    modifierGroups: [],
  };

  it("is null for a normal item", () => {
    expect(itemUnavailableReason(ok)).toBeNull();
  });

  it("reports hidden items and categories, and out-of-stock items", () => {
    expect(itemUnavailableReason({ ...ok, category: { isActive: false } })).toBe("hidden");
    expect(itemUnavailableReason({ ...ok, item: { isActive: false, isAvailable: true } })).toBe(
      "hidden",
    );
    expect(itemUnavailableReason({ ...ok, item: { isActive: true, isAvailable: false } })).toBe(
      "outOfStock",
    );
  });

  it("blocks items whose required options are all out of stock", () => {
    const size = (available: boolean[]) => ({
      minSelect: 1,
      modifiers: available.map((isAvailable) => ({ isAvailable })),
    });
    expect(itemUnavailableReason({ ...ok, modifierGroups: [size([false, false])] })).toBe(
      "requiredOptionUnavailable",
    );
    expect(itemUnavailableReason({ ...ok, modifierGroups: [size([false, true])] })).toBeNull();
    // Optional groups never block.
    expect(
      itemUnavailableReason({
        ...ok,
        modifierGroups: [{ minSelect: 0, modifiers: [{ isAvailable: false }] }],
      }),
    ).toBeNull();
    // "Pick 2" needs two available options.
    expect(
      itemUnavailableReason({ ...ok, modifierGroups: [{ ...size([true, false]), minSelect: 2 }] }),
    ).toBe("requiredOptionUnavailable");
  });
});
