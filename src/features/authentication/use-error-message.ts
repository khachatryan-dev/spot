"use client";

import { useTranslations } from "next-intl";

/** Translate a validation message key from the auth schemas (falls back to a generic error). */
export function useErrorMessage() {
  const t = useTranslations("Auth.errors");
  return (key: string | undefined) =>
    key === undefined ? undefined : t.has(key as never) ? t(key as never) : t("generic");
}
