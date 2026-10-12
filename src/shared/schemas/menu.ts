import { z } from "zod";

import { ALLERGENS, DIETARY_TAGS, MAX_PRICE_MINOR } from "@/shared/constants/menu";

import { openingHoursSchema } from "./opening-hours";

const name = z.string().trim().min(1, "nameRequired").max(120, "nameTooLong");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();
const translation = z.object({
  name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
});
const translations = z.object({ en: translation, hy: translation, ru: translation }).partial();
const price = z
  .number()
  .int("priceInvalid")
  .min(0, "priceInvalid")
  .max(MAX_PRICE_MINOR, "priceInvalid");
const unique = <T extends z.ZodType>(schema: z.ZodArray<T>) =>
  schema.refine((list) => new Set(list).size === list.length, "duplicate");

export const menuSchema = z.object({
  name,
  description: optionalText(1000),
  translations: translations.optional(),
  isActive: z.boolean().optional(),
  /** null = available whenever the location is open. */
  availableHours: openingHoursSchema.nullable().optional(),
  /** Locations serving this menu; replaces the current set when given. */
  locationIds: unique(z.array(z.uuid()).max(100)).optional(),
});

export const categorySchema = z.object({
  name,
  description: optionalText(1000),
  translations: translations.optional(),
  isActive: z.boolean().optional(),
});

export const itemSchema = z.object({
  categoryId: z.uuid(),
  name,
  description: optionalText(2000),
  translations: translations.optional(),
  priceMinor: price,
  ingredients: optionalText(1000),
  allergens: unique(z.array(z.enum(ALLERGENS))).optional(),
  dietaryTags: unique(z.array(z.enum(DIETARY_TAGS))).optional(),
  prepTimeMinutes: z.number().int().min(0).max(600).nullish(),
  isActive: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
});

const selection = {
  minSelect: z.number().int().min(0).max(20),
  maxSelect: z.number().int().min(1).max(20),
};
export const modifierGroupSchema = z
  .object({ name, translations: translations.optional(), ...selection })
  .refine((g) => g.maxSelect >= g.minSelect, { message: "maxBelowMin", path: ["maxSelect"] });
export const modifierGroupUpdateSchema = z
  .object({ name, translations: translations.optional(), ...selection })
  .partial()
  .refine(
    (g) => g.minSelect === undefined || g.maxSelect === undefined || g.maxSelect >= g.minSelect,
    {
      message: "maxBelowMin",
      path: ["maxSelect"],
    },
  );

export const modifierSchema = z.object({
  name,
  translations: translations.optional(),
  priceDeltaMinor: price.default(0),
  isDefault: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
});

/** Partial updates never carry defaults, so omitted fields stay untouched. */
export const menuUpdateSchema = menuSchema.partial();
export const categoryUpdateSchema = categorySchema.partial();
export const itemUpdateSchema = itemSchema.partial();
export const modifierUpdateSchema = z
  .object(modifierSchema.shape)
  .extend({ priceDeltaMinor: price })
  .partial();

export type MenuInput = z.input<typeof menuSchema>;
export type CategoryInput = z.input<typeof categorySchema>;
export type ItemInput = z.input<typeof itemSchema>;
export type ModifierGroupInput = z.input<typeof modifierGroupSchema>;
export type ModifierInput = z.input<typeof modifierSchema>;
