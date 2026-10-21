import "server-only";

import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { safeRedirectPath } from "@/shared/utils/safe-redirect";

/**
 * Who a sign-in / sign-up page speaks to (`?for=restaurant`). Accounts are
 * the same for everyone; only the wording and where you land afterwards differ.
 */
export type AuthAudience = "guest" | "restaurant";

export function authAudience(value: string | string[] | undefined): AuthAudience {
  return value === "restaurant" ? "restaurant" : "guest";
}

/**
 * Where to go after signing in or up: a safe `?next=` path, else the
 * audience's own start: guests to the app's home, new owners straight to creating
 * their restaurant.
 */
export function audienceTarget(
  next: string | string[] | undefined,
  audience: AuthAudience,
  page: "login" | "register",
  locale: Locale,
) {
  const start =
    audience === "guest" ? "/home" : page === "register" ? "/dashboard/new" : "/dashboard";
  return safeRedirectPath(
    typeof next === "string" ? next : undefined,
    getPathname({ href: start, locale }),
  );
}

/** Query for links between the sign-in and sign-up pages: keeps `next` and the audience. */
export function audienceQuery(next: string | string[] | undefined, audience: AuthAudience) {
  return {
    ...(typeof next === "string" ? { next } : {}),
    ...(audience === "restaurant" ? { for: "restaurant" } : {}),
  };
}
