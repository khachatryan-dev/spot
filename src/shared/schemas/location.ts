import { z } from "zod";

import { MAX_SERVICE_FEE_BPS } from "@/shared/constants/bills";
import {
  MAX_DEPOSIT_MINOR,
  REFUND_CUTOFF_HOURS,
  RESERVATION_CONFIRMATION_MODES,
  RESERVATION_DEPOSIT_TYPES,
  RESERVATION_DURATION,
  RESERVATION_MAX_DAYS_AHEAD,
  RESERVATION_MIN_NOTICE,
} from "@/shared/constants/reservations";
import { LOCATION_STATUSES } from "@/shared/constants/restaurants";

import { openingHoursSchema } from "./opening-hours";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();

/** Form inputs arrive as strings; "" means "not set". */
const coordinate = (min: number, max: number) =>
  z.preprocess(
    (v) =>
      v === "" || v === undefined ? null : typeof v === "string" ? Number(v.replace(",", ".")) : v,
    z
      .number("coordinateInvalid")
      .min(min, "coordinateInvalid")
      .max(max, "coordinateInvalid")
      .nullable(),
  );

const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/** A whole number within a settings range (form selects send strings). */
const whole = ({ min, max }: { min: number; max: number }) =>
  z.coerce.number().int().min(min, "settingOutOfRange").max(max, "settingOutOfRange");

/** Fields for adding a location (onboarding uses the same). */
export const createLocationSchema = z.object({
  name: z.string().trim().min(2, "nameTooShort").max(100, "nameTooLong"),
  addressLine: z.string().trim().min(3, "addressRequired").max(200),
  city: z.string().trim().min(2, "cityRequired").max(100),
  phone: optionalText(30),
});

/** Full location settings (§11). Partial on update; the slug never changes. */
export const updateLocationSchema = createLocationSchema
  .extend({
    postalCode: optionalText(20),
    latitude: coordinate(-90, 90),
    longitude: coordinate(-180, 180),
    timezone: z.string().refine(isTimeZone, "timezoneInvalid"),
    openingHours: openingHoursSchema,
    reservationsEnabled: z.boolean(),
    reservationConfirmation: z.enum(RESERVATION_CONFIRMATION_MODES),
    reservationDurationMinutes: whole(RESERVATION_DURATION),
    reservationMinNoticeMinutes: whole(RESERVATION_MIN_NOTICE),
    reservationMaxDaysAhead: whole(RESERVATION_MAX_DAYS_AHEAD),
    reservationDepositType: z.enum(RESERVATION_DEPOSIT_TYPES),
    /** Minor units; the form converts what the owner types. */
    reservationDepositMinor: z
      .number("amountInvalid")
      .int("amountInvalid")
      .min(0, "amountInvalid")
      .max(MAX_DEPOSIT_MINOR, "amountInvalid"),
    reservationRefundCutoffHours: whole(REFUND_CUTOFF_HOURS),
    serviceFeeBps: whole({ min: 0, max: MAX_SERVICE_FEE_BPS }),
    status: z.enum(LOCATION_STATUSES),
  })
  .partial()
  .refine(
    (v) =>
      v.latitude === undefined ||
      v.longitude === undefined ||
      (v.latitude === null) === (v.longitude === null),
    { message: "coordinatesPair", path: ["longitude"] },
  )
  .refine(
    (v) =>
      v.reservationDepositType === undefined ||
      v.reservationDepositType === "none" ||
      (v.reservationDepositMinor ?? 0) > 0,
    { message: "depositRequired", path: ["reservationDepositMinor"] },
  );

export type CreateLocationInput = z.input<typeof createLocationSchema>;
export type UpdateLocationInput = z.input<typeof updateLocationSchema>;
