import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Camera, QrCode, UtensilsCrossed } from "lucide-react";

import { QrScanner } from "@/features/customer-app/qr-scanner";
import { resolveLocale } from "@/i18n/locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("CustomerApp.scan");
  return { title: t("title"), robots: { index: false } };
}

const STEPS = [
  ["camera", Camera],
  ["point", QrCode],
  ["menu", UtensilsCrossed],
] as const;

/** Scan a table's QR code in the app; the phone's own camera works too. */
export default async function ScanPage({ params }: PageProps<"/[locale]/scan">) {
  await resolveLocale(params);
  const t = await getTranslations("CustomerApp.scan");

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex flex-col gap-1 px-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <QrScanner />
      <h2 className="px-1 pt-2 text-sm font-semibold text-muted-foreground">{t("otherWay")}</h2>
      <ol className="flex flex-col gap-2">
        {STEPS.map(([key, Icon], index) => (
          <li
            key={key}
            className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="text-sm">
              <span className="font-semibold">{index + 1}. </span>
              {t(`steps.${key}`)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
