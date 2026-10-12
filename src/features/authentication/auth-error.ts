/** Map a Better Auth client error to a translation key under `Auth.errors`. */
export function authErrorKey(error: { code?: string; status?: number } | null | undefined) {
  if (!error) return "generic";
  if (error.status === 429) return "rateLimited";
  if (error.code === "INVALID_EMAIL_OR_PASSWORD") return "invalidCredentials";
  if (error.code?.startsWith("USER_ALREADY_EXISTS")) return "emailTaken";
  // Our session hook refuses suspended accounts (auth.ts).
  if (error.code === "FAILED_TO_CREATE_SESSION") return "accountSuspended";
  return "generic";
}

export type AuthErrorKey = ReturnType<typeof authErrorKey>;
