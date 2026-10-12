import "server-only";

import { env } from "@/shared/config/env";
import { TABLE_SESSION_IDLE_HOURS } from "@/shared/constants/table-sessions";

/**
 * Remembers which table session this browser is at, so /table survives
 * refreshes without putting the session id in the URL. It is only a pointer:
 * access still requires being a member (see getCustomerTableSession).
 */
export const TABLE_COOKIE = env.NODE_ENV === "production" ? "__Host-spot.table" : "spot.table";

export const tableCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: TABLE_SESSION_IDLE_HOURS * 60 * 60,
} as const;
