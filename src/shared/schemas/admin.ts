import { z } from "zod";

/** Reason shown to the owner when a restaurant is rejected or suspended. */
export const statusReasonSchema = z.object({
  reason: z.string().trim().min(10, "reasonTooShort").max(1000, "reasonTooLong"),
});

export type StatusReasonInput = z.input<typeof statusReasonSchema>;
