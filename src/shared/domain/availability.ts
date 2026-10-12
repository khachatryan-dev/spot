import { type OpeningHours, WEEKDAYS, type Weekday } from "@/shared/schemas/opening-hours";

/*
 * Availability rules (§15, §16). Pure functions shared by the customer menu
 * and order validation, so what guests see and what the server accepts can't
 * disagree.
 */

const toMinutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Weekday and minutes since midnight at `at`, in the location's time zone. */
export function localTime(at: Date, timeZone: string): { day: Weekday; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("weekday").slice(0, 3).toLowerCase() as Weekday;
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * Is `at` inside the schedule? A period whose close is before its open runs
 * past midnight: Fri 18:00–02:00 also covers Saturday 00:00–01:59.
 */
export function isOpenAt(hours: Partial<OpeningHours>, timeZone: string, at: Date): boolean {
  const { day, minutes } = localTime(at, timeZone);
  const yesterday = WEEKDAYS[(WEEKDAYS.indexOf(day) + 6) % 7]!;

  const today = (hours[day] ?? []).some(({ open, close }) => {
    const o = toMinutes(open);
    const c = toMinutes(close);
    return c > o ? minutes >= o && minutes < c : minutes >= o; // overnight: until midnight today
  });
  if (today) return true;

  return (hours[yesterday] ?? []).some(({ open, close }) => {
    const c = toMinutes(close);
    return c <= toMinutes(open) && minutes < c; // tail of last night's overnight period
  });
}

export interface AvailabilityContext {
  location: {
    openingHours: Partial<OpeningHours>;
    timezone: string;
    status: "active" | "inactive";
  };
  menu: { isActive: boolean; availableHours: Partial<OpeningHours> | null };
  at: Date;
}

/** True if at least one day has an opening period. */
export const hasAnyHours = (hours: Partial<OpeningHours>) =>
  Object.values(hours).some((periods) => (periods?.length ?? 0) > 0);

/**
 * A menu is available while its location is open and inside its own hours,
 * if it has any. A location with no hours at all hasn't configured them yet,
 * so it doesn't restrict anything (otherwise every new restaurant would look
 * closed to guests).
 */
export function isMenuAvailable({ location, menu, at }: AvailabilityContext): boolean {
  if (location.status !== "active" || !menu.isActive) return false;
  if (
    hasAnyHours(location.openingHours) &&
    !isOpenAt(location.openingHours, location.timezone, at)
  ) {
    return false;
  }
  return menu.availableHours === null || isOpenAt(menu.availableHours, location.timezone, at);
}

export interface ItemAvailabilityInput {
  category: { isActive: boolean };
  item: { isActive: boolean; isAvailable: boolean };
  modifierGroups: { minSelect: number; modifiers: { isAvailable: boolean }[] }[];
}

export type ItemUnavailableReason = "hidden" | "outOfStock" | "requiredOptionUnavailable";

/** Why an item can't be ordered right now (ignoring menu hours), or null if it can. */
export function itemUnavailableReason({
  category,
  item,
  modifierGroups,
}: ItemAvailabilityInput): ItemUnavailableReason | null {
  if (!category.isActive || !item.isActive) return "hidden";
  if (!item.isAvailable) return "outOfStock";
  const blocked = modifierGroups.some(
    (g) => g.minSelect > g.modifiers.filter((m) => m.isAvailable).length,
  );
  return blocked ? "requiredOptionUnavailable" : null;
}
