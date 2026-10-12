import "server-only";

import { timingSafeEqual } from "node:crypto";

import { env } from "@/shared/config/env";
import { AppError } from "@/shared/errors";

/** Does an `Authorization` header carry `Bearer <secret>`? Constant-time. */
export function isCronAuthorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduled jobs are called by Vercel Cron with `Authorization: Bearer
 * $CRON_SECRET`. Without the secret configured the jobs don't exist (404).
 */
export function assertCronRequest(request: Request) {
  if (!env.CRON_SECRET) throw new AppError("NOT_FOUND");
  if (!isCronAuthorized(request.headers.get("authorization"), env.CRON_SECRET)) {
    throw new AppError("UNAUTHORIZED");
  }
}
