import { z } from "zod";

/**
 * Sign-in / sign-up validation shared by forms and server code.
 * Messages are translation keys under `Auth.errors`.
 */
const email = z.string().trim().toLowerCase().min(1, "emailRequired").pipe(z.email("emailInvalid"));

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "passwordRequired"),
});

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "nameRequired").max(100, "nameTooLong"),
  email,
  password: z.string().min(8, "passwordTooShort").max(128, "passwordTooLong"),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
