import { clientEnvSchema, parseEnv } from "./env-schema";

/**
 * Validated browser-safe environment.
 *
 * Each variable is referenced explicitly so Next.js can inline it into the
 * client bundle; passing `process.env` as a whole would not work in the browser.
 */
export const clientEnv = parseEnv(
  clientEnvSchema,
  {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_STORAGE_URL: process.env.NEXT_PUBLIC_STORAGE_URL,
  },
  "client",
);
