import "server-only";

import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { safeRedirectPath } from "@/shared/utils/safe-redirect";

/** Where to go after signing in: a safe `?next=` path, or this locale's home page. */
export function redirectTarget(next: string | string[] | undefined, locale: Locale) {
  return safeRedirectPath(
    typeof next === "string" ? next : undefined,
    getPathname({ href: "/", locale }),
  );
}
