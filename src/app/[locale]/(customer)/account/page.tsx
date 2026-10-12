import { CalendarDays, Heart, Star } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { ProfileForm } from "@/features/account/profile-form";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { guardPage, requireUser } from "@/server/auth/guards";
import { getProfile, listFavorites, listMyVisits } from "@/server/services/account-service";
import { bookingPath } from "@/shared/utils/booking-url";
import { formatMoney } from "@/shared/utils/money";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account");
  return { title: t("title"), robots: { index: false } };
}

const isLocale = (value: string | null): value is (typeof routing.locales)[number] =>
  (routing.locales as readonly string[]).includes(value ?? "");

/** The signed-in guest's account (§25): profile, saved places, past visits. */
export default async function AccountPage({ params }: PageProps<"/[locale]/account">) {
  const locale = await resolveLocale(params);
  const user = await guardPage(locale, requireUser);
  const [profile, saved, visits] = await Promise.all([
    getProfile(user),
    listFavorites(user),
    listMyVisits(user, 20),
  ]);
  const t = await getTranslations("Account");
  const format = await getFormatter();

  return (
    <div className="flex flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <nav aria-label={t("shortcuts")} className="grid grid-cols-2 gap-2">
        <Link
          href="/reservations"
          className="flex items-center gap-2 rounded-xl border p-3 text-sm font-medium hover:bg-muted"
        >
          <CalendarDays className="size-4" aria-hidden />
          {t("reservations")}
        </Link>
        <Link
          href="/reviews"
          className="flex items-center gap-2 rounded-xl border p-3 text-sm font-medium hover:bg-muted"
        >
          <Star className="size-4" aria-hidden />
          {t("reviews")}
        </Link>
      </nav>

      <ProfileForm
        email={profile.email}
        defaults={{
          name: profile.name ?? "",
          phone: profile.phone ?? "",
          preferredLocale: isLocale(profile.preferredLocale) ? profile.preferredLocale : locale,
        }}
      />

      <section aria-labelledby="favorites-heading" className="flex flex-col gap-3">
        <h2 id="favorites-heading" className="flex items-center gap-2 text-lg font-semibold">
          <Heart className="size-5" aria-hidden />
          {t("favoritesTitle")}
        </h2>
        {saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("favoritesEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {saved.map((f) => (
              <li
                key={f.restaurantId}
                className="flex items-center justify-between gap-2 rounded-xl border p-3"
              >
                <span className="font-medium">{f.name}</span>
                {f.bookingLocationSlug && (
                  <Link
                    href={bookingPath(f.slug, f.bookingLocationSlug)}
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {t("book")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="visits-heading" className="flex flex-col gap-3">
        <h2 id="visits-heading" className="text-lg font-semibold">
          {t("visitsTitle")}
        </h2>
        {visits.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("visitsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visits.map((v) => (
              <li key={v.sessionId} className="flex flex-col gap-1 rounded-xl border p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{v.restaurantName}</span>
                  <span className="tabular-nums">
                    {formatMoney(v.spentMinor, v.currency, locale)}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {format.dateTime(v.visitedAt, { day: "numeric", month: "long", year: "numeric" })}{" "}
                  · {v.locationName} · {t("orders", { count: v.orderCount })}
                </span>
                {v.restaurantPublic && v.bookingLocationSlug && (
                  <Link
                    href={bookingPath(v.restaurantSlug, v.bookingLocationSlug)}
                    className="self-start font-medium underline-offset-4 hover:underline"
                  >
                    {t("bookAgain")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
