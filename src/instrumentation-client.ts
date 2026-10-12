import * as Sentry from "@sentry/nextjs";

import { sentryDataCollection, sentryTracesSampleRate } from "@/shared/config/sentry";

import { clientEnv } from "@/shared/config/env.client";

// Browser error reporting. Disabled until NEXT_PUBLIC_SENTRY_DSN is set.
if (clientEnv.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: clientEnv.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: sentryTracesSampleRate,
    dataCollection: sentryDataCollection,
  });
}
