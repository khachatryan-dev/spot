import { routing, type Locale } from "./routing";

/** Split `/en/dashboard` into `{ locale: "en", path: "/dashboard" }`; unprefixed paths use the default locale. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const [, first, ...rest] = pathname.split("/");
  const locale = routing.locales.find((l) => l === first);
  if (!locale) return { locale: routing.defaultLocale, path: pathname || "/" };
  return { locale, path: `/${rest.join("/")}` };
}

/** Prefix a path for a locale (`as-needed`: the default locale has no prefix). */
export function localizePath(path: string, locale: Locale): string {
  if (locale === routing.defaultLocale) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/** Areas that need a signed-in user. */
const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/reservations", "/account", "/notifications"];

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
