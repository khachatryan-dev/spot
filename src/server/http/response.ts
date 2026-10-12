import "server-only";

import { logger } from "@/server/logger";
import type { ApiResult } from "@/shared/errors";

import { toAppError } from "./to-app-error";

/** Normalize a thrown value and log it if it was unexpected. */
function toReportedError(error: unknown) {
  const appError = toAppError(error);
  if (appError.code === "INTERNAL_ERROR") {
    logger.error("Unhandled error", { err: appError.cause ?? appError });
  }
  return appError;
}

/** 2xx response: `{ data, error: null }`. */
export function ok<T>(data: T, init?: ResponseInit): Response {
  const body: ApiResult<T> = { data, error: null };
  return Response.json(body, init);
}

/** Error response: `{ data: null, error }` with the status for its code. */
export function fail(error: unknown): Response {
  const appError = toReportedError(error);
  const body: ApiResult<never> = { data: null, error: appError.toJSON() };
  return Response.json(body, { status: appError.status });
}

/**
 * Wrap a route handler so thrown errors become safe `{ data, error }` responses.
 *
 * @example
 * export const GET = route(async () => ok(await listRestaurants()));
 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return fail(error);
    }
  };
}

/** Same contract for Server Actions, which return values instead of Responses. */
export async function action<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    return { data: await fn(), error: null };
  } catch (error) {
    return { data: null, error: toReportedError(error).toJSON() };
  }
}
