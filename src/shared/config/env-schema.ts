import { z } from "zod";

/** `KEY=` in a .env file yields "", which should count as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/**
 * Server-side variables (§50).
 *
 * Services that are not built yet are optional; make each one required on the
 * roadmap day that starts using it (e.g. REDIS_URL on Day 47).
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: optional(z.enum(["debug", "info", "warn", "error"])),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Connections per server instance. Keep it low (e.g. 3) on serverless hosts. */
  DATABASE_POOL_MAX: optional(z.coerce.number().int().min(1).max(50)),
  REDIS_URL: optional(z.url()),

  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  AUTH_URL: optional(z.url()),

  GOOGLE_CLIENT_ID: optional(z.string().min(1)),
  GOOGLE_CLIENT_SECRET: optional(z.string().min(1)),

  STORAGE_ENDPOINT: optional(z.url()),
  STORAGE_ACCESS_KEY: optional(z.string().min(1)),
  STORAGE_SECRET_KEY: optional(z.string().min(1)),
  STORAGE_BUCKET: optional(z.string().min(1)),
  /** "auto" for Cloudflare R2; e.g. "eu-central-1" for AWS S3. */
  STORAGE_REGION: optional(z.string().min(1)),

  /**
   * Provider for new payments. "fake" moves no money: development and E2E
   * only — never set it on a real deployment. Unset in production = no
   * online payments (deposits can't be switched on).
   */
  PAYMENT_PROVIDER: optional(z.enum(["fake"])),
  PAYMENT_PROVIDER_KEY: optional(z.string().min(1)),
  PAYMENT_WEBHOOK_SECRET: optional(z.string().min(1)),

  SENTRY_DSN: optional(z.url()),

  /** Bearer secret Vercel Cron sends to /api/cron/*. Without it the jobs are off. */
  CRON_SECRET: optional(z.string().min(16, "CRON_SECRET must be at least 16 characters")),

  /** Realtime (ADR 0001). Optional: without it, screens keep polling. */
  ABLY_API_KEY: optional(
    z.string().regex(/^[^:]+\.[^:]+:.+$/, "ABLY_API_KEY must look like app.key:secret"),
  ),
});

/** Browser-safe variables. Only `NEXT_PUBLIC_*` values may appear here. */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_MAPBOX_TOKEN: optional(z.string().min(1)),
  NEXT_PUBLIC_POSTHOG_KEY: optional(z.string().min(1)),
  NEXT_PUBLIC_POSTHOG_HOST: optional(z.url()),
  NEXT_PUBLIC_SENTRY_DSN: optional(z.url()),
  /** Public base URL of the uploads bucket or its CDN, e.g. https://img.spot.am */
  NEXT_PUBLIC_STORAGE_URL: optional(z.url()),
});

export function parseEnv<T extends z.ZodType>(
  schema: T,
  values: Record<string, unknown>,
  label: string,
): z.infer<T> {
  const result = schema.safeParse(values);
  if (!result.success) {
    // Fail fast at startup; never print the values themselves.
    throw new Error(`Invalid ${label} environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
