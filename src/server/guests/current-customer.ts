import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getSession, type SessionUser } from "@/server/auth/session";
import type { Guest } from "@/server/db/schema";

import { GUEST_COOKIE, guestCookieOptions } from "./guest-cookie";
import { createGuest, findGuestByToken } from "./guest-service";

export type Customer = { type: "user"; user: SessionUser } | { type: "guest"; guest: Guest };

/** Current guest from the cookie, or null. Safe in Server Components (read-only). */
export const getGuest = cache(async (): Promise<Guest | null> => {
  const store = await cookies();
  return findGuestByToken(store.get(GUEST_COOKIE)?.value);
});

/**
 * Who is ordering: a signed-in user takes priority over a guest cookie.
 * Returns null for a first-time visitor.
 */
export const getCustomer = cache(async (): Promise<Customer | null> => {
  const session = await getSession();
  if (session) return { type: "user", user: session.user };
  const guest = await getGuest();
  return guest ? { type: "guest", guest } : null;
});

/**
 * Return the current guest, creating one and setting its cookie if needed.
 * Cookies can only be written from Server Actions and Route Handlers, so call
 * this there (e.g. when a QR code is scanned, Day 33) — not during rendering.
 */
export async function ensureGuest(): Promise<Guest> {
  const existing = await getGuest();
  if (existing) return existing;

  const { guest, token } = await createGuest();
  (await cookies()).set(GUEST_COOKIE, token, guestCookieOptions);
  return guest;
}
