import { Bell, CalendarDays, ChevronRight, Heart, ReceiptText, Star } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { SignOutButton } from "@/components/shared/sign-out-button";
import { ProfileForm } from "@/features/account/profile-form";
import { Stars } from "@/features/reviews/stars";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { guardPage, requireUser } from "@/server/auth/guards";
import {
  getProfile,
  getVisitSummary,
  listFavorites,
  listMyVisits,
} from "@/server/services/account-service";
import { listMyCustomerReviews } from "@/server/services/customer-review-service";
import { listMyReviews } from "@/server/services/review-service";
import { bookingPath } from "@/shared/utils/booking-url";
import { formatMoney } from "@/shared/utils/money";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account");
  return { title: t("title"), robots: { index: false } };
}

const isLocale = (value: string | null): value is (typeof routing.locales)[number] =>
  (routing.locales as readonly string[]).includes(value ?? "");

const card = "rounded-3xl bg-card shadow-sm ring-1 ring-border";

/** The signed-in guest's profile (§25), laid out like a banking app's profile screen. */
export default async function AccountPage({ params }: PageProps<"/[locale]/account">) {
  const locale = await resolveLocale(params);
  const user = await guardPage(locale, requireUser);
  const [profile, saved, visits, summary, reviews, aboutMe] = await Promise.all([
    getProfile(user),
    listFavorites(user),
    listMyVisits(user, 20),
    getVisitSummary(user),
    listMyReviews(user),
    listMyCustomerReviews(user),
  ]);
  const r = await getTranslations("Reviews");
  const aboutMeAverage =
    aboutMe.length > 0 ? aboutMe.reduce((sum, x) => sum + x.rating, 0) / aboutMe.length : null;
  const t = await getTranslations("Account");
  const format = await getFormatter();
  const displayName = profile.name?.trim() || profile.email;
  const mainSpend = summary.spent[0];

  const menu = [
    { href: "/reservations", label: t("reservations"), Icon: CalendarDays },
    { href: "/reviews", label: t("reviews"), Icon: Star },
    { href: "/notifications", label: t("notifications"), Icon: Bell },
  ];

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="px-1 text-2xl font-bold">{t("title")}</h1>

      {/* Who you are, and your numbers */}
      <section
        aria-label={t("profileTitle")}
        className="flex flex-col gap-4 rounded-3xl bg-gradient-to-br from-orange-700 to-rose-600 p-5 text-white shadow-lg shadow-orange-700/20"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-14 shrink-0 place-items-center rounded-full bg-white text-2xl font-bold text-orange-800 uppercase"
          >
            {displayName.charAt(0)}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-lg font-semibold">{displayName}</span>
            <span className="truncate text-sm text-white">{profile.email}</span>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-black/15 p-2">
            <dt className="text-xs text-white">{t("stats.visits")}</dt>
            <dd className="text-xl font-bold tabular-nums">{summary.visits}</dd>
          </div>
          <div className="rounded-2xl bg-black/15 p-2">
            <dt className="text-xs text-white">{t("stats.spent")}</dt>
            <dd className="truncate text-xl font-bold tabular-nums">
              {formatMoney(mainSpend?.minor ?? 0, mainSpend?.currency ?? "AMD", locale)}
            </dd>
          </div>
          <div className="rounded-2xl bg-black/15 p-2">
            <dt className="text-xs text-white">{t("stats.reviews")}</dt>
            <dd className="text-xl font-bold tabular-nums">{reviews.length}</dd>
          </div>
        </dl>
      </section>

      {/* Settings-style menu */}
      <nav aria-label={t("shortcuts")} className={card}>
        <ul className="divide-y">
          {menu.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link href={href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/50">
                <span className="grid size-9 place-items-center rounded-xl bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="flex-1 text-sm font-medium">{label}</span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Personal details */}
      <div className={`${card} p-4`}>
        <ProfileForm
          email={profile.email}
          defaults={{
            name: profile.name ?? "",
            phone: profile.phone ?? "",
            preferredLocale: isLocale(profile.preferredLocale) ? profile.preferredLocale : locale,
          }}
        />
      </div>

      {/* Saved places */}
      <section
        id="favorites"
        aria-labelledby="favorites-heading"
        className={`${card} flex scroll-mt-20 flex-col gap-2 p-4`}
      >
        <h2 id="favorites-heading" className="flex items-center gap-2 font-semibold">
          <Heart className="size-5 text-rose-600 dark:text-rose-400" aria-hidden />
          {t("favoritesTitle")}
        </h2>
        {saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("favoritesEmpty")}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {saved.map((f) => (
              <li key={f.restaurantId} className="flex items-center gap-3 py-2.5">
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 text-sm font-bold text-white uppercase"
                >
                  {f.name.trim().charAt(0)}
                </span>
                <Link href={`/r/${f.slug}`} className="flex-1 truncate font-medium">
                  {f.name}
                </Link>
                {f.bookingLocationSlug && (
                  <Link
                    href={bookingPath(f.slug, f.bookingLocationSlug)}
                    className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground"
                  >
                    {t("book")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Visit history */}
      <section
        id="visits"
        aria-labelledby="visits-heading"
        className={`${card} flex scroll-mt-20 flex-col gap-2 p-4`}
      >
        <h2 id="visits-heading" className="flex items-center gap-2 font-semibold">
          <ReceiptText className="size-5 text-muted-foreground" aria-hidden />
          {t("visitsTitle")}
        </h2>
        {visits.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("visitsEmpty")}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {visits.map((v) => (
              <li key={v.sessionId} className="flex flex-col gap-1 py-2.5 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{v.restaurantName}</span>
                  <span className="font-semibold tabular-nums">
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
                    className="self-start text-xs font-semibold text-primary"
                  >
                    {t("bookAgain")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Two-way reviews: what restaurants said about you as a guest */}
      <section
        id="rated"
        aria-labelledby="rated-heading"
        className={`${card} flex scroll-mt-20 flex-col gap-2 p-4`}
      >
        <h2 id="rated-heading" className="flex items-center gap-2 font-semibold">
          <Star className="size-5 text-amber-500" aria-hidden />
          {t("ratedTitle")}
        </h2>
        {aboutMeAverage === null ? (
          <p className="text-sm text-muted-foreground">{t("ratedEmpty")}</p>
        ) : (
          <>
            <p className="text-sm font-medium">
              {t("ratedAverage", { average: aboutMeAverage.toFixed(1), count: aboutMe.length })}
            </p>
            <ul className="flex flex-col divide-y">
              {aboutMe.map((x) => (
                <li key={x.id} className="flex flex-col gap-1 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{x.restaurantName}</span>
                    <Stars rating={x.rating} label={r("ratingOf", { rating: x.rating })} />
                  </div>
                  {x.comment && <p className="text-sm whitespace-pre-line">{x.comment}</p>}
                  <span className="text-xs text-muted-foreground">
                    {t(`ratedVisit.${x.subject}`)} ·{" "}
                    {format.dateTime(x.updatedAt, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className={`${card} p-2`}>
        <SignOutButton className="w-full justify-center text-destructive hover:text-destructive" />
      </div>
    </div>
  );
}
