import "server-only";

import { env } from "@/shared/config/env";

import { GUEST_TTL_MS } from "./guest-service";

/**
 * `__Host-` (production, https) binds the cookie to this exact host and path,
 * so subdomains can't set or read it.
 */
export const GUEST_COOKIE = env.NODE_ENV === "production" ? "__Host-spot.guest" : "spot.guest";

export const guestCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: GUEST_TTL_MS / 1000,
} as const;

/** Read the guest token from a raw Cookie header (used where next/headers isn't available). */
export function guestTokenFromCookieHeader(cookieHeader: string | null | undefined) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === GUEST_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}
