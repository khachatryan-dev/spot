import "server-only";

import { env } from "@/shared/config/env";

import { createLogger } from "./logger";

export type { LogContext, Logger, LogLevel } from "./logger";

/** App-wide structured logger. Use `logger.child({ module: "…" })` per module. */
export const logger = createLogger({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === "production" ? "info" : "debug"),
  format: env.NODE_ENV === "production" ? "json" : "pretty",
});
