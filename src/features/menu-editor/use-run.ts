"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useApiError } from "@/components/shared/use-api-error";
import { useRouter } from "@/i18n/navigation";
import type { ApiResult } from "@/shared/errors";

/** Run a Server Action: track which row is busy, toast errors, refresh on success. */
export function useRun() {
  const apiError = useApiError();
  const fieldErrors = useTranslations("Forms.errors");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function run<T>(key: string, task: () => Promise<ApiResult<T>>, success?: string) {
    setBusy(key);
    const result = await task();
    setBusy(null);
    if (result.error) {
      // Prefer the specific reason ("This table number already exists") over the generic one.
      const key = Object.values(result.error.fieldErrors ?? {})[0]?.[0];
      toast.error(
        key && fieldErrors.has(key as never)
          ? fieldErrors(key as never)
          : apiError.message(result.error),
      );
      return null;
    }
    if (success) toast.success(success);
    router.refresh();
    return result.data;
  }

  return { busy, run };
}
