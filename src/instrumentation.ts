import * as Sentry from "@sentry/nextjs";

import { sentryDataCollection, sentryTracesSampleRate } from "@/shared/config/sentry";

/** Runs once per server start. Sentry stays disabled until SENTRY_DSN is set. */
export async function register() {
  const { env } = await import("@/shared/config/env");
  if (!env.SENTRY_DSN) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: sentryTracesSampleRate,
    dataCollection: sentryDataCollection,
  });
}

/** Reports errors from Server Components, route handlers and Server Actions. */
export const onRequestError = Sentry.captureRequestError;
