import { z } from "zod";

import { routing } from "@/i18n/routing";

import { phoneSchema } from "./reservation";

/** What a signed-in guest can change about themselves (§25). */
export const profileSchema = z.object({
  name: z.string().trim().min(2, "nameTooShort").max(100, "nameTooLong"),
  /** Pre-fills booking forms; "" removes it. */
  phone: z.union([z.literal(""), phoneSchema]).transform((v) => (v === "" ? null : v)),
  preferredLocale: z.enum(routing.locales),
});

export type ProfileInput = z.input<typeof profileSchema>;
