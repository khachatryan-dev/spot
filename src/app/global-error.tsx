"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import "./globals.css";

/**
 * Last resort when the root layout itself fails: no translations are
 * available here, so the text is in both languages.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="hy">
      <body className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center font-sans">
        <title>Spot</title>
        <h1 className="text-xl font-semibold">Ինչ-որ բան սխալ գնաց · Something went wrong</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Փորձեք կրկին մի քանի վայրկյանից։ · Please try again in a few seconds.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Փորձել կրկին · Try again
        </button>
        {error.digest && <p className="text-xs text-muted-foreground">{error.digest}</p>}
      </body>
    </html>
  );
}
