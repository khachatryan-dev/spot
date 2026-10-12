import { z } from "zod";

import { MAX_TABLE_CAPACITY } from "@/shared/constants/tables";

/** A real calendar date as "YYYY-MM-DD" (rejects 2026-02-30). */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "dateInvalid")
  .refine((value) => {
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
  }, "dateInvalid");

export const partySizeSchema = z.coerce
  .number("partySizeInvalid")
  .int("partySizeInvalid")
  .min(1, "partySizeInvalid")
  .max(MAX_TABLE_CAPACITY, "partySizeInvalid");

/** Which times can a party book at a location on a date (§20)? */
export const availabilityQuerySchema = z.object({
  date: calendarDateSchema,
  partySize: partySizeSchema,
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/** "+374 91 00-00-00" → "+37491000000". */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-().]/g, ""))
  .pipe(z.string().regex(/^\+?[0-9]{6,15}$/, "phoneInvalid"));

/** What a guest fills in to turn a held time into a reservation. */
export const reservationContactSchema = z.object({
  contactName: z.string().trim().min(1, "nameRequired").max(100, "nameTooLong"),
  contactPhone: phoneSchema,
  note: z
    .string()
    .trim()
    .max(500, "noteTooLong")
    .transform((v) => (v === "" ? null : v))
    .nullish(),
});

export const createReservationSchema = reservationContactSchema.extend({ holdId: z.uuid() });

export type CreateReservationInput = z.input<typeof createReservationSchema>;
