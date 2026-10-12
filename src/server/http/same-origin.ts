import "server-only";

import { env } from "@/shared/config/env";
import { clientEnv } from "@/shared/config/env.client";
import { AppError } from "@/shared/errors";

/**
 * CSRF defence for cookie-authenticated Route Handlers (Server Actions have
 * this built in): state-changing requests must come from our own origin.
 */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = new URL(env.AUTH_URL ?? clientEnv.NEXT_PUBLIC_APP_URL).origin;
  if (origin !== allowed && origin !== new URL(request.url).origin) {
    throw new AppError("FORBIDDEN", "Cross-site request blocked.");
  }
}
