"use client";

import * as Sentry from "@sentry/nextjs";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/**
 * Unexpected errors while rendering a page. Server details never reach the
 * browser; the digest lets support find the matching server log.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("Status");
  useEffect(() => {
    Sentry.captureException(error); // a no-op until Sentry is configured
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <TriangleAlert className="size-12 text-destructive" aria-hidden />
      <h1 className="text-xl font-semibold">{t("errorTitle")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t("errorDescription")}</p>
      <div className="mt-2 flex gap-2">
        <Button onClick={() => retry()}>{t("retry")}</Button>
        <Button render={<Link href="/" />} variant="outline">
          {t("home")}
        </Button>
      </div>
      {error.digest && (
        <p className="text-xs text-muted-foreground">{t("reference", { code: error.digest })}</p>
      )}
    </main>
  );
}
