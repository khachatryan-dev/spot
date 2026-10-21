import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  CalendarDays,
  ChevronRight,
  Compass,
  Heart,
  QrCode,
  ReceiptText,
  Star,
  UtensilsCrossed,
} from "lucide-react";

import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getSession } from "@/server/auth/session";
import { getCustomer } from "@/server/guests/current-customer";
import { getVisitSummary, listFavorites, listMyVisits } from "@/server/services/account-service";
import { listMyReservations } from "@/server/services/reservation-service";
import { listReviewOpportunities } from "@/server/services/review-service";
import { getCurrentTableSession } from "@/server/table-sessions/current";
import { ACTIVE_RESERVATION_STATUSES } from "@/shared/constants/reservations";
import { formatMoney } from "@/shared/utils/money";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("CustomerApp.home");
  return { title: t("title"), robots: { index: false } };
}

const TILES = [
  { key: "explore", href: "/restaurants", Icon: Compass },
  { key: "bookings", href: "/reservations", Icon: CalendarDays },
  { key: "orders", href: "/table/orders", Icon: ReceiptText },
  { key: "favorites", href: "/account#favorites", Icon: Heart },
] as const;

const card = "rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border";

/**
 * The customer app's home, like a banking app: who you are and what you've
 * spent, the big Scan button, then what matters now (your table, your next
 * booking, a visit to rate) and your places.
 */
export default async function HomePage({ params }: PageProps<"/[locale]/home">) {
  const locale = await resolveLocale(params);
  const [session, table, customer] = await Promise.all([
    getSession(),
    getCurrentTableSession(),
    getCustomer(),
  ]);
  const user = session?.user;
  const [summary, reservations, favorites, visits, toRate] = await Promise.all([
    user ? getVisitSummary(user) : null,
    user ? listMyReservations(user) : [],
    user ? listFavorites(user) : [],
    user ? listMyVisits(user, 3) : [],
    customer ? listReviewOpportunities(customer) : [],
  ]);
  const t = await getTranslations("CustomerApp.home");
  const status = await getTranslations("Reservations.status");
  const format = await getFormatter();

  const firstName = user?.name?.trim().split(/\s+/)[0];
  const now = new Date();
  const nextBooking = reservations.find(
    (r) => r.endsAt > now && (ACTIVE_RESERVATION_STATUSES as readonly string[]).includes(r.status),
  );
  const mainSpend = summary?.spent[0];

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header card */}
      <section className="relative isolate flex flex-col gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-orange-700 to-rose-600 p-5 text-white shadow-lg shadow-orange-700/20">
        <div
          aria-hidden
          className="absolute -top-10 -right-10 -z-10 size-40 rounded-full bg-white/10"
        />
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">
            {firstName ? t("greeting", { name: firstName }) : t("greetingGuest")}
          </h1>
          <p className="text-sm text-white">{t("subtitle")}</p>
        </div>
        {summary && (
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-black/15 p-3">
              <dt className="text-xs text-white">{t("stats.visits")}</dt>
              <dd className="text-2xl font-bold tabular-nums">{summary.visits}</dd>
            </div>
            <div className="rounded-2xl bg-black/15 p-3">
              <dt className="text-xs text-white">{t("stats.spent")}</dt>
              <dd className="truncate text-2xl font-bold tabular-nums">
                {formatMoney(mainSpend?.minor ?? 0, mainSpend?.currency ?? "AMD", locale)}
              </dd>
            </div>
          </dl>
        )}
        <Link
          href="/scan"
          className="flex items-center justify-center gap-3 rounded-2xl bg-white py-4 text-lg font-bold text-orange-800 shadow-md transition-transform active:scale-[0.98] dark:bg-card dark:text-orange-300"
        >
          <QrCode className="size-7" aria-hidden />
          {t("scan")}
        </Link>
      </section>

      {/* At a table right now */}
      {table && (
        <section
          aria-labelledby="home-table"
          className={`${card} flex flex-col gap-3 ring-2 ring-emerald-500/40`}
        >
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              <UtensilsCrossed className="size-5" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col">
              <h2 id="home-table" className="font-semibold">
                {t("table.title", { number: table.table.number })}
              </h2>
              <span className="truncate text-sm text-muted-foreground">
                {table.restaurant.name} · {table.location.name}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm font-medium">
            <Link href="/table" className="rounded-xl bg-primary py-2 text-primary-foreground">
              {t("table.menu")}
            </Link>
            <Link href="/table/orders" className="rounded-xl bg-secondary py-2">
              {t("table.orders")}
            </Link>
            <Link href="/table/bill" className="rounded-xl bg-secondary py-2">
              {t("table.bill")}
            </Link>
          </div>
        </section>
      )}

      {/* Quick tiles */}
      <ul className="grid grid-cols-4 gap-2">
        {TILES.map(({ key, href, Icon }) => (
          <li key={key}>
            <Link
              href={href}
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-card p-3 text-center text-xs font-medium shadow-sm ring-1 ring-border transition-colors hover:bg-orange-50 dark:hover:bg-orange-950/40"
            >
              <span className="grid size-11 place-items-center rounded-2xl bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                <Icon className="size-5" aria-hidden />
              </span>
              {t(`tiles.${key}`)}
            </Link>
          </li>
        ))}
      </ul>

      {/* Next booking */}
      {nextBooking && (
        <Link href="/reservations" className={`${card} flex items-center gap-3`}>
          <span className="flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
            <span className="text-xs font-medium uppercase">
              {format.dateTime(nextBooking.startsAt, {
                month: "short",
                timeZone: nextBooking.timezone,
              })}
            </span>
            <span className="text-xl leading-none font-bold">
              {format.dateTime(nextBooking.startsAt, {
                day: "numeric",
                timeZone: nextBooking.timezone,
              })}
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs text-muted-foreground">{t("nextBooking")}</span>
            <span className="truncate font-semibold">{nextBooking.restaurantName}</span>
            <span className="text-sm text-muted-foreground">
              {format.dateTime(nextBooking.startsAt, {
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: nextBooking.timezone,
              })}{" "}
              · {t("people", { count: nextBooking.partySize })} · {status(nextBooking.status)}
            </span>
          </span>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
        </Link>
      )}

      {/* A visit waiting for a review */}
      {toRate[0] && (
        <Link
          href="/reviews"
          className={`${card} flex items-center gap-3 bg-amber-50 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-800`}
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            <Star className="size-5" aria-hidden />
          </span>
          <span className="flex-1 text-sm font-medium">
            {t("rate", { restaurant: toRate[0].restaurantName })}
          </span>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
        </Link>
      )}

      {/* Favourites */}
      {favorites.length > 0 && (
        <section aria-labelledby="home-favorites" className="flex flex-col gap-2">
          <h2 id="home-favorites" className="px-1 font-semibold">
            {t("favorites")}
          </h2>
          <ul className="-mx-4 flex [scrollbar-width:none] gap-3 overflow-x-auto px-4 pb-1">
            {favorites.map((f) => (
              <li key={f.restaurantId} className="w-36 shrink-0">
                <Link href={`/r/${f.slug}`} className={`${card} flex h-full flex-col gap-2 p-3`}>
                  <span
                    aria-hidden
                    className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 font-bold text-white uppercase"
                  >
                    {f.name.trim().charAt(0)}
                  </span>
                  <span className="line-clamp-2 text-sm font-medium">{f.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Recent visits */}
      {visits.length > 0 && (
        <section aria-labelledby="home-visits" className={`${card} flex flex-col gap-1`}>
          <div className="flex items-center justify-between">
            <h2 id="home-visits" className="font-semibold">
              {t("recent")}
            </h2>
            <Link href="/account#visits" className="text-sm font-medium text-primary">
              {t("seeAll")}
            </Link>
          </div>
          <ul className="flex flex-col divide-y">
            {visits.map((v) => (
              <li key={v.sessionId} className="flex items-center gap-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                  <ReceiptText className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{v.restaurantName}</span>
                  <span className="text-xs text-muted-foreground">
                    {format.dateTime(v.visitedAt, { dateStyle: "medium" })}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatMoney(v.spentMinor, v.currency, locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!user && (
        <section className={`${card} flex flex-col gap-3 p-5`}>
          <h2 className="font-semibold">{t("signInTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("signInText")}</p>
          <div className="flex gap-2">
            <Link
              href="/login"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              {t("signIn")}
            </Link>
            <Link
              href="/register"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-primary"
            >
              {t("register")}
            </Link>
          </div>
        </section>
      )}

      {user && !nextBooking && visits.length === 0 && favorites.length === 0 && !table && (
        <Link href="/restaurants" className={`${card} flex items-center gap-3`}>
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
            <Compass className="size-5" aria-hidden />
          </span>
          <span className="flex flex-1 flex-col">
            <span className="font-semibold">{t("emptyTitle")}</span>
            <span className="text-sm text-muted-foreground">{t("emptyText")}</span>
          </span>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
        </Link>
      )}
    </div>
  );
}
