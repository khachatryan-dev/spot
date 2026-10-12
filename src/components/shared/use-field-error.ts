"use client";

import { useTranslations } from "next-intl";

/** Translate a Zod message key from shared schemas (unknown keys → generic "invalid"). */
export function useFieldError() {
  const t = useTranslations("Forms.errors");
  return (key: string | undefined) =>
    key === undefined ? undefined : t.has(key as never) ? t(key as never) : t("invalid");
}
