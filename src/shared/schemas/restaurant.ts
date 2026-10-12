import { z } from "zod";

import { ARMENIA_VAT_BPS } from "@/shared/constants/bills";

import { CUISINES, MAX_CUISINES } from "@/shared/constants/cuisines";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();

/** Fields an owner can edit. Status, slug and approval fields are never accepted here. */
export const restaurantProfileSchema = z.object({
  name: z.string().trim().min(2, "nameTooShort").max(100, "nameTooLong"),
  description: optionalText(2000),
  cuisines: z
    .array(z.enum(CUISINES))
    .max(MAX_CUISINES, "tooManyCuisines")
    .refine((list) => new Set(list).size === list.length, "duplicateCuisine"),
  priceRange: z.number().int().min(1).max(4).nullish(),
  phone: optionalText(30),
  email: z
    .union([z.literal(""), z.email().max(200)])
    .transform((v) => (v === "" ? null : v.toLowerCase()))
    .nullish(),
  website: z
    .union([z.literal(""), z.url({ protocol: /^https?$/ }).max(300)])
    .transform((v) => (v === "" ? null : v))
    .nullish(),
  /** VAT payer: bills show the VAT included in prices (0 = not a VAT payer). */
  vatRateBps: z.union([z.literal(0), z.literal(ARMENIA_VAT_BPS)]).optional(),
});

export const createRestaurantSchema = restaurantProfileSchema.extend({
  cuisines: restaurantProfileSchema.shape.cuisines.default([]),
});
/**
 * Partial update: omitted fields stay untouched. No defaults here, or an
 * update that doesn't mention a field would reset it.
 */
export const updateRestaurantSchema = restaurantProfileSchema.partial();

export type CreateRestaurantInput = z.input<typeof createRestaurantSchema>;
export type UpdateRestaurantInput = z.input<typeof updateRestaurantSchema>;
