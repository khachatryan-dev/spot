import { captureException } from "@sentry/nextjs";

import { redact } from "./redact";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  /** Pass the thrown value as `context.err`; it is also reported to Sentry. */
  error(message: string, context?: LogContext): void;
  /** Logger that adds `bindings` to every entry, e.g. `{ module: "orders" }`. */
  child(bindings: LogContext): Logger;
}

interface LoggerOptions {
  level: LogLevel;
  /** One JSON object per line (production) or readable lines (development). */
  format: "json" | "pretty";
  write?: (line: string, level: LogLevel) => void;
}

const defaultWrite = (line: string, level: LogLevel) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export function createLogger(options: LoggerOptions, bindings: LogContext = {}): Logger {
  const minLevel = LOG_LEVELS.indexOf(options.level);
  const write = options.write ?? defaultWrite;

  const log = (level: LogLevel, message: string, context?: LogContext) => {
    if (LOG_LEVELS.indexOf(level) < minLevel) return;

    const fields = redact({ ...bindings, ...context }) as LogContext;
    const entry = { level, time: new Date().toISOString(), msg: message, ...fields };

    if (options.format === "json") {
      write(JSON.stringify(entry), level);
    } else {
      const extra = Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
      write(`${entry.time} ${level.toUpperCase().padEnd(5)} ${message}${extra}`, level);
    }

    if (level === "error" && context?.err !== undefined) {
      // No-op when Sentry has no DSN.
      captureException(context.err, { extra: { message, ...fields } });
    }
  };

  return {
    debug: (message, context) => log("debug", message, context),
    info: (message, context) => log("info", message, context),
    warn: (message, context) => log("warn", message, context),
    error: (message, context) => log("error", message, context),
    child: (childBindings) => createLogger(options, { ...bindings, ...childBindings }),
  };
}
