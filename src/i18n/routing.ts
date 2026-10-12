import { defineRouting } from "next-intl/routing";

/**
 * Languages (§38). Armenian is the default and has no URL prefix
 * (`/…`); other languages are prefixed (`/en/…`). Add a locale here and a
 * matching `messages/<locale>.json` to support a new language.
 */
export const routing = defineRouting({
  locales: ["hy", "en"],
  defaultLocale: "hy",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
