import { getFormatter, getTranslations } from "next-intl/server";

import { BarChart } from "@/features/stats/bar-chart";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { guardPage, requireUser } from "@/server/auth/guards";
import { listLocations } from "@/server/services/location-service";
import { getRestaurantStats, STATS_RANGES } from "@/server/services/restaurant-analytics-service";
import { formatMoney } from "@/shared/utils/money";

/** A restaurant's numbers for the last 7, 30 or 90 days (analytics:read). */
export default async function StatsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/stats">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const query = await searchParams;
  const days = Number(query.days) || 30;
  const locationId = typeof query.location === "string" ? query.location : undefined;
  const { stats, locations } = await guardPage(locale, async () => {
    const user = await requireUser();
    const stats = await getRestaurantStats(user, restaurantId, { days, locationId });
    const locations = (await listLocations(user, restaurantId)).filter(
      (l) => l.status === "active",
    );
    return { stats, locations };
  });
  const t = await getTranslations("Stats");
  const format = await getFormatter();
  const money = (minor: number) => formatMoney(minor, stats.currency, locale);
  const percent = (value: number | null) =>
    value === null ? "—" : format.number(value, { style: "percent", maximumFractionDigits: 0 });
  const base = `/dashboard/r/${restaurantId}/stats`;
  const href = (changes: Record<string, string | undefined>) => ({
    pathname: base,
    query: Object.fromEntries(
      Object.entries({ days: String(stats.days), location: locationId, ...changes }).filter(
        (e): e is [string, string] => e[1] !== undefined,
      ),
    ),
  });
  const pill = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-sm",
      active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
    );

  const card = (label: string, value: string, sub?: string) => (
    <div className="rounded-xl border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label={t("rangeLabel")} className="flex gap-2">
          {STATS_RANGES.map((range) => (
            <Link
              key={range}
              href={href({ days: String(range) })}
              aria-current={range === stats.days ? "page" : undefined}
              className={pill(range === stats.days)}
            >
              {t("range", { days: range })}
            </Link>
          ))}
        </nav>
        {locations.length > 1 && (
          <nav aria-label={t("locationLabel")} className="flex flex-wrap gap-2">
            <Link
              href={href({ location: undefined })}
              aria-current={!locationId ? "page" : undefined}
              className={pill(!locationId)}
            >
              {t("allLocations")}
            </Link>
            {locations.map((l) => (
              <Link
                key={l.id}
                href={href({ location: l.id })}
                aria-current={l.id === locationId ? "page" : undefined}
                className={pill(l.id === locationId)}
              >
                {l.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <section aria-labelledby="guests-heading" className="flex flex-col gap-2">
        <h2 id="guests-heading" className="font-semibold">
          {t("guestsTitle")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {card(t("qrScans"), String(stats.guests.qrScans))}
          {card(t("visits"), String(stats.guests.visits))}
          {card(
            t("returning"),
            String(stats.guests.returning),
            t("ofVisitors", { count: stats.guests.visitors }),
          )}
          {card(
            t("pageViews"),
            String(stats.guests.pageViews),
            t("bookingViews", { count: stats.guests.bookingViews }),
          )}
        </dl>
      </section>

      <section aria-labelledby="orders-heading" className="flex flex-col gap-2">
        <h2 id="orders-heading" className="font-semibold">
          {t("ordersTitle")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {card(
            t("revenue"),
            money(stats.orders.revenueMinor),
            t("averageOrder", {
              amount: stats.orders.averageMinor === null ? "—" : money(stats.orders.averageMinor),
            }),
          )}
          {card(
            t("ordersPlaced"),
            String(stats.orders.placed),
            t("completedCount", { count: stats.orders.completed }),
          )}
          {card(t("successRate"), percent(stats.orders.successRate))}
          {card(t("cancelledRejected"), `${stats.orders.cancelled} / ${stats.orders.rejected}`)}
        </dl>
      </section>

      <section aria-labelledby="reservations-heading" className="flex flex-col gap-2">
        <h2 id="reservations-heading" className="font-semibold">
          {t("reservationsTitle")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {card(t("reservationsMade"), String(stats.reservations.made))}
          {card(t("reservationsCompleted"), String(stats.reservations.completed))}
          {card(t("noShows"), String(stats.reservations.noShows))}
          {card(
            t("rating"),
            stats.reviews.average === null ? "—" : `${format.number(stats.reviews.average)} ★`,
            t("newReviews", { count: stats.reviews.count }),
          )}
        </dl>
      </section>

      <BarChart
        title={t("dailyChart")}
        valueLabel={t("ordersPlaced")}
        bars={stats.daily.map((d) => ({
          label: format.dateTime(new Date(`${d.date}T12:00:00Z`), {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }),
          value: d.orders,
          display: `${d.orders} · ${money(d.revenueMinor)}`,
        }))}
      />
      <BarChart
        title={t("hoursChart")}
        valueLabel={t("ordersPlaced")}
        bars={stats.hours.map((h) => ({
          label: `${String(h.hour).padStart(2, "0")}:00`,
          value: h.orders,
        }))}
      />

      <section aria-labelledby="top-heading" className="flex flex-col gap-2">
        <h2 id="top-heading" className="font-semibold">
          {t("topItems")}
        </h2>
        {stats.topItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noOrders")}</p>
        ) : (
          <ol className="flex flex-col divide-y rounded-xl border text-sm">
            {stats.topItems.map((item) => (
              <li key={item.name} className="flex justify-between gap-2 p-3">
                <span>{item.name}</span>
                <span className="tabular-nums">
                  {t("sold", { count: item.quantity })} · {money(item.revenueMinor)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        {t("timezoneNote", { timezone: stats.timezone })}
      </p>
    </div>
  );
}
