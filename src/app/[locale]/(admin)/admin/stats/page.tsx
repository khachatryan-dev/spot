import { getFormatter, getTranslations } from "next-intl/server";

import { BarChart } from "@/features/stats/bar-chart";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { guardPage, requirePlatformPermission } from "@/server/auth/guards";
import { getPlatformStats, PLATFORM_RANGES } from "@/server/services/platform-analytics-service";

/** Platform-wide year-one metrics (§4.2) for admins. */
export default async function AdminStatsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/stats">) {
  const locale = await resolveLocale(params);
  const days = Number((await searchParams).days) || 30;
  const stats = await guardPage(locale, async () =>
    getPlatformStats(await requirePlatformPermission("platform:analytics:read"), { days }),
  );
  const t = await getTranslations("AdminStats");
  const format = await getFormatter();
  const percent = (value: number | null) =>
    value === null ? "—" : format.number(value, { style: "percent", maximumFractionDigits: 0 });
  const card = (label: string, value: string | number, sub?: string) => (
    <div className="rounded-2xl border border-l-4 border-l-orange-500 bg-card p-3 shadow-sm">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
  const dayLabel = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <nav aria-label={t("rangeLabel")} className="flex gap-2">
          {PLATFORM_RANGES.map((range) => (
            <Link
              key={range}
              href={{ pathname: "/admin/stats", query: { days: String(range) } }}
              aria-current={range === stats.days ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                range === stats.days
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {t("range", { days: range })}
            </Link>
          ))}
        </nav>
      </div>

      <section aria-labelledby="active-heading" className="flex flex-col gap-2">
        <h2 id="active-heading" className="font-semibold">
          {t("activeTitle")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {card(t("restaurants"), stats.active.restaurants)}
          {card(t("locations"), stats.active.locations)}
          {card(t("tables"), stats.active.tables)}
          {card(
            t("retention"),
            percent(stats.restaurantRetention.rate),
            t("retentionDetail", {
              retained: stats.restaurantRetention.retained,
              previous: stats.restaurantRetention.previous,
            }),
          )}
        </dl>
      </section>

      <section aria-labelledby="activity-heading" className="flex flex-col gap-2">
        <h2 id="activity-heading" className="font-semibold">
          {t("activityTitle")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {card(t("qrScans"), stats.totals.qrScans)}
          {card(
            t("orders"),
            stats.totals.orders,
            t("completed", { count: stats.totals.completedOrders }),
          )}
          {card(t("successRate"), percent(stats.totals.successRate))}
          {card(
            t("reservations"),
            stats.totals.reservations,
            t("completed", { count: stats.totals.completedReservations }),
          )}
        </dl>
      </section>

      <section aria-labelledby="customers-heading" className="flex flex-col gap-2">
        <h2 id="customers-heading" className="font-semibold">
          {t("customersTitle")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {card(t("activeCustomers"), stats.customers.active)}
          {card(t("monthlyActive"), stats.customers.monthlyActive)}
          {card(t("returning"), stats.customers.returning)}
        </dl>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <BarChart
          title={t("ordersChart")}
          valueLabel={t("orders")}
          bars={stats.daily.map((d) => ({ label: dayLabel(d.date), value: d.orders }))}
        />
        <BarChart
          title={t("scansChart")}
          valueLabel={t("qrScans")}
          bars={stats.daily.map((d) => ({ label: dayLabel(d.date), value: d.qrScans }))}
        />
      </div>

      <section aria-labelledby="top-heading" className="flex flex-col gap-2">
        <h2 id="top-heading" className="font-semibold">
          {t("topTitle")}
        </h2>
        {stats.topRestaurants.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noActivity")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2">
                  {t("restaurant")}
                </th>
                <th scope="col" className="py-2 text-right">
                  {t("orders")}
                </th>
                <th scope="col" className="py-2 text-right">
                  {t("reservations")}
                </th>
                <th scope="col" className="py-2 text-right">
                  {t("qrScans")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stats.topRestaurants.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="py-2 text-left font-medium">
                    <Link
                      href={`/admin/restaurants/${r.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                  </th>
                  <td className="py-2 text-right tabular-nums">{r.orders}</td>
                  <td className="py-2 text-right tabular-nums">{r.reservations}</td>
                  <td className="py-2 text-right tabular-nums">{r.qrScans}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="text-xs text-muted-foreground">{t("definition")}</p>
    </div>
  );
}
