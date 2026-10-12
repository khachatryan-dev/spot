import type { MetadataRoute } from "next";

/*
 * Sitemap and robots rules (§39), as pure functions so they can be tested
 * without a server.
 */

const LOCALES = ["hy", "en"] as const;
const DEFAULT_LOCALE = "hy";

const localized = (path: string, locale: (typeof LOCALES)[number]) =>
  locale === DEFAULT_LOCALE ? path : path === "/" ? `/${locale}` : `/${locale}${path}`;

/** One entry per page and language, each listing all its language versions. */
export function sitemapEntries(
  appUrl: string,
  pages: { path: string; lastModified?: Date; priority?: number }[],
): MetadataRoute.Sitemap {
  const base = appUrl.replace(/\/$/, "");
  const url = (path: string) => (path === "/" ? base : `${base}${path}`);
  return pages.flatMap(({ path, lastModified, priority }) => {
    const languages = Object.fromEntries(LOCALES.map((l) => [l, url(localized(path, l))]));
    return LOCALES.map((locale) => ({
      url: url(localized(path, locale)),
      ...(lastModified && { lastModified }),
      ...(priority !== undefined && { priority }),
      alternates: { languages },
    }));
  });
}

/** Never crawled: private areas, guest flows and one-off links. */
export const PRIVATE_PATHS = [
  "/api/",
  "/dashboard",
  "/admin",
  "/account",
  "/reservations",
  "/reviews",
  "/table",
  "/t/",
  "/invite/",
  "/dev/",
  "/login",
  "/register",
];

export function robotsRules(appUrl: string): MetadataRoute.Robots {
  const disallow = PRIVATE_PATHS.flatMap((path) =>
    path === "/api/" ? [path] : LOCALES.map((l) => localized(path, l)),
  );
  return {
    rules: [{ userAgent: "*", allow: "/", disallow }],
    sitemap: `${appUrl.replace(/\/$/, "")}/sitemap.xml`,
  };
}
