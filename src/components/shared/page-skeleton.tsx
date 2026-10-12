import { getTranslations } from "next-intl/server";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder while a page loads (loading.tsx). Announced once to screen
 * readers; the shapes themselves are decorative.
 */
export async function PageSkeleton({ rows = 4 }: { rows?: number }) {
  const t = await getTranslations("Status");
  return (
    <div role="status" className="flex flex-col gap-4 p-4">
      <span className="sr-only">{t("loading")}</span>
      <Skeleton className="h-8 w-48" aria-hidden />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-2xl" aria-hidden />
      ))}
    </div>
  );
}
