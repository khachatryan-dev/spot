import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { PrintButton } from "@/features/tables/print-button";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requireUser } from "@/server/auth/guards";
import { qrSvgDataUri } from "@/server/qr/qr-image";
import { listLocationQr } from "@/server/services/qr-service";
import { getRestaurant } from "@/server/services/restaurant-service";
import { qrUrl } from "@/shared/utils/qr-url";

/** Printable QR cards: one per active table, A4-friendly, never split across pages. */
export default async function PrintQrPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/tables/print">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const { location } = await searchParams;
  const { restaurant, cards } = await guardPage(locale, async () => {
    const user = await requireUser();
    const restaurant = await getRestaurant(user, restaurantId);
    const rows = await listLocationQr(
      user,
      restaurantId,
      typeof location === "string" ? location : "",
    );
    const cards = await Promise.all(
      rows
        .filter((r) => r.isActive && r.token)
        .map(async (r) => ({
          id: r.tableId,
          number: r.number,
          image: await qrSvgDataUri(qrUrl(r.token!)),
        })),
    );
    return { restaurant, cards };
  });
  // Both languages on the card: guests include tourists.
  const hy = await getTranslations({ locale: "hy", namespace: "Tables.print" });
  const en = await getTranslations({ locale: "en", namespace: "Tables.print" });
  const t = await getTranslations("Tables.print");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/dashboard/r/${restaurantId}/tables`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Link>
        <PrintButton />
      </div>
      <p className="text-sm text-muted-foreground print:hidden">
        {t("hint", { count: cards.length })}
      </p>
      <ul className="grid grid-cols-2 gap-4 print:gap-6" aria-label={t("cards")}>
        {cards.map((card) => (
          <li
            key={card.id}
            className="flex break-inside-avoid flex-col items-center gap-2 rounded-2xl border-2 p-5 text-center"
          >
            <span className="text-sm font-medium">{restaurant.name}</span>
            <span className="text-xs tracking-wide text-muted-foreground uppercase">
              {hy("table")} · Table
            </span>
            <span className="text-5xl leading-none font-bold">{card.number}</span>
            <Image
              src={card.image}
              alt={t("qrAlt", { number: card.number })}
              width={180}
              height={180}
              unoptimized
              className="bg-white"
            />
            <span className="text-sm font-medium">{hy("scan")}</span>
            <span className="text-xs text-muted-foreground">{en("scan")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
