"use client";

import { useTranslations } from "next-intl";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import type { ApiError } from "@/shared/errors";

/** Translate an API error code, and push server-side field errors into a form. */
export function useApiError() {
  const t = useTranslations("ApiErrors");
  return {
    message: (error: ApiError) => t(error.code),
    applyFieldErrors: <T extends FieldValues>(error: ApiError, setError: UseFormSetError<T>) => {
      for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
        setError(field as Path<T>, { message: messages[0] });
      }
    },
  };
}
