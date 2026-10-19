import { z } from "zod";

import { CONTACT_TOPICS, MAX_CONTACT_MESSAGE } from "@/shared/constants/contact";

/** The public contact form. */
export const contactSchema = z.object({
  name: z.string().trim().min(2, "nameTooShort").max(100, "nameTooLong"),
  email: z.string().trim().toLowerCase().max(254, "emailInvalid").pipe(z.email("emailInvalid")),
  topic: z.enum(CONTACT_TOPICS),
  message: z.string().trim().min(10, "messageTooShort").max(MAX_CONTACT_MESSAGE, "messageTooLong"),
});

export type ContactInput = z.input<typeof contactSchema>;
