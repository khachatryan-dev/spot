import type { init } from "@sentry/nextjs";

type SentryOptions = NonNullable<Parameters<typeof init>[0]>;

/**
 * Privacy-first Sentry data collection (§41): no request/response bodies,
 * no cookies, no automatic user info, only non-sensitive headers.
 */
export const sentryDataCollection: SentryOptions["dataCollection"] = {
  userInfo: false,
  cookies: false,
  httpBodies: [],
  httpHeaders: { allow: ["user-agent", "content-type", "accept-language", "referer"] },
};

export const sentryTracesSampleRate = process.env.NODE_ENV === "production" ? 0.1 : 1;
