import { z } from "zod";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "timeInvalid");
const toMinutes = (value: string) => {
  const [h = 0, m = 0] = value.split(":").map(Number);
  return h * 60 + m;
};

/**
 * One opening period in the location's local time. `close` earlier than
 * `open` means the period ends after midnight (e.g. 18:00–02:00).
 */
export const openingPeriodSchema = z
  .object({ open: time, close: time })
  .refine((p) => p.open !== p.close, { message: "periodEmpty", path: ["close"] });

/** Up to 3 periods per day (e.g. lunch and dinner); an empty day means closed. */
const daySchema = z
  .array(openingPeriodSchema)
  .max(3, "tooManyPeriods")
  .refine(
    (periods) => {
      // Same-day periods must not overlap (overnight periods are checked by their start only).
      const sorted = [...periods].sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
      return sorted.every((p, i) => {
        const next = sorted[i + 1];
        if (!next) return true;
        const end = toMinutes(p.close) <= toMinutes(p.open) ? 24 * 60 : toMinutes(p.close);
        return end <= toMinutes(next.open);
      });
    },
    { message: "periodsOverlap" },
  );

export const openingHoursSchema = z.object(
  Object.fromEntries(WEEKDAYS.map((day) => [day, daySchema.default([])])) as Record<
    Weekday,
    z.ZodDefault<typeof daySchema>
  >,
);

export type OpeningPeriod = z.infer<typeof openingPeriodSchema>;
export type OpeningHours = z.infer<typeof openingHoursSchema>;

export const CLOSED_ALL_WEEK: OpeningHours = {
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};
