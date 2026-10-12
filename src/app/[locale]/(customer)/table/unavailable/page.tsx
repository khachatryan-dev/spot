import type { Metadata } from "next";
import { QrCode } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { resolveLocale } from "@/i18n/locale";

export async function generateMetadata(): Promise<Metadata> {
  return { robots: { index: false } };
}

/** Shown for unknown, revoked or expired QR codes — deliberately without saying which. */
export default async function UnavailablePage({
  params,
  searchParams,
}: PageProps<"/[locale]/table/unavailable">) {
  await resolveLocale(params);
  // "busy" = scan rate limit; tell legitimate guests to retry instead of "not active".
  const busy = (await searchParams).reason === "busy";
  const t = await getTranslations("TableSession");
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <QrCode className="size-12 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">{busy ? t("busyTitle") : t("unavailableTitle")}</h1>
      <p className="text-sm text-muted-foreground">
        {busy ? t("busyDescription") : t("unavailableDescription")}
      </p>
    </div>
  );
}
