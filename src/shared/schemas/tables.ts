import { z } from "zod";

import { MAX_TABLE_CAPACITY, TABLE_STATUSES, TABLE_TYPES } from "@/shared/constants/tables";

const number = z.string().trim().min(1, "tableNumberRequired").max(20, "tableNumberTooLong");
const capacity = z
  .number()
  .int()
  .min(1, "capacityInvalid")
  .max(MAX_TABLE_CAPACITY, "capacityInvalid");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();

export const tableSchema = z.object({
  locationId: z.uuid(),
  number,
  name: optionalText(60),
  capacity: capacity.default(4),
  zone: optionalText(60),
  type: z.enum(TABLE_TYPES).default("standard"),
});

export const tableUpdateSchema = z
  .object({
    number,
    name: optionalText(60),
    capacity,
    zone: optionalText(60),
    type: z.enum(TABLE_TYPES),
    status: z.enum(TABLE_STATUSES),
    isActive: z.boolean(),
  })
  .partial();

export const MAX_BULK_TABLES = 100;

/** "Add tables 1–20": numbered tables with the same capacity and zone. */
export const bulkTablesSchema = z
  .object({
    locationId: z.uuid(),
    from: z.number().int().min(1).max(9999),
    to: z.number().int().min(1).max(9999),
    capacity: capacity.default(4),
    zone: optionalText(60),
  })
  .refine((v) => v.to >= v.from, { message: "rangeInvalid", path: ["to"] })
  .refine((v) => v.to - v.from < MAX_BULK_TABLES, { message: "rangeTooLarge", path: ["to"] });

export type TableInput = z.input<typeof tableSchema>;
export type TableUpdateInput = z.input<typeof tableUpdateSchema>;
export type BulkTablesInput = z.input<typeof bulkTablesSchema>;
