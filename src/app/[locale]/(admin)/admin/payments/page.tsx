import { AlertTriangle } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requirePlatformPermission } from "@/server/auth/guards";
import {
  listPaymentProblems,
  listPayments,
  paymentFilterSchema,
  paymentTotals,
} from "@/server/services/admin-payment-service";
import { PAYMENT_STATUSES } from "@/shared/constants/payments";
import { formatMoney } from "@/shared/utils/money";

const select =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";
const day = (d: Date | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/** Payment monitoring (platform:payments:read): problems first, totals, every payment. */
export default async function AdminPaymentsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/payments">) {
  const locale = await resolveLocale(params);
  const filter = paymentFilterSchema.parse(await searchParams);
  const { rows, totals, problems } = await guardPage(locale, async () => {
    const admin = await requirePlatformPermission("platform:payments:read");
    const [rows, totals, problems] = await Promise.all([
      listPayments(admin, filter),
      paymentTotals(admin, filter),
      listPaymentProblems(admin),
    ]);
    return { rows, totals, problems };
  });
  const t = await getTranslations("AdminPayments");
  const format = await getFormatter();
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <section aria-labelledby="problems-heading" className="flex flex-col gap-2">
        <h2 id="problems-heading" className="flex items-center gap-2 text-lg font-semibold">
          <AlertTriangle className="size-5" aria-hidden />
          {t("problemsTitle", { count: problems.length })}
        </h2>
        {problems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noProblems")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {problems.map((p) => (
              <li key={`${p.kind}-${p.paymentId}-${p.at.toISOString()}`}>
                <Link
                  href={`/admin/payments/${p.paymentId}`}
                  className="flex flex-wrap justify-between gap-2 rounded-xl border border-destructive/40 p-3 text-sm hover:bg-muted"
                >
                  <span>
                    <span className="font-medium">{t(`problems.${p.kind}`)}</span> ·{" "}
                    {p.restaurantName}
                  </span>
                  <span className="tabular-nums">
                    {money(p.amountMinor, p.currency)} ·{" "}
                    {format.dateTime(p.at, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="flex flex-wrap items-end gap-3 text-sm" aria-label={t("filtersLabel")}>
        {filter.restaurant && <input type="hidden" name="restaurant" value={filter.restaurant} />}
        <div className="flex flex-col gap-1">
          <Label htmlFor="status">{t("status")}</Label>
          <select id="status" name="status" defaultValue={filter.status ?? ""} className={select}>
            <option value="">{t("any")}</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="from">{t("from")}</Label>
          <Input
            id="from"
            name="from"
            type="date"
            defaultValue={day(filter.from)}
            className="w-auto"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="to">{t("to")}</Label>
          <Input id="to" name="to" type="date" defaultValue={day(filter.to)} className="w-auto" />
        </div>
        <Button type="submit" variant="secondary">
          {t("apply")}
        </Button>
        {filter.restaurant && (
          <Link
            href="/admin/payments"
            className="h-8 content-center underline-offset-4 hover:underline"
          >
            {t("allRestaurants")}
          </Link>
        )}
      </form>

      <section aria-labelledby="totals-heading" className="flex flex-col gap-2">
        <h2 id="totals-heading" className="sr-only">
          {t("totalsTitle")}
        </h2>
        {totals.map((total) => (
          <dl key={total.currency} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                [
                  "paid",
                  money(total.paidMinor, total.currency),
                  t("paidCount", { count: total.paidCount }),
                ],
                ["refunded", money(total.refundedMinor, total.currency), null],
                ["failed", String(total.failedCount), null],
                ["pending", String(total.pendingCount), null],
              ] as const
            ).map(([key, value, sub]) => (
              <div key={key} className="rounded-xl border p-3">
                <dt className="text-xs text-muted-foreground">{t(`totals.${key}`)}</dt>
                <dd className="text-lg font-semibold tabular-nums">{value}</dd>
                {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
              </div>
            ))}
          </dl>
        ))}
      </section>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-2xl border" aria-label={t("listLabel")}>
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/admin/payments/${p.id}`}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-muted"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{p.restaurantName}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`purposes.${p.purpose}`)} · {p.provider} ·{" "}
                    {format.dateTime(p.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{money(p.amountMinor, p.currency)}</span>
                  <Badge variant={p.status === "succeeded" ? "default" : "outline"}>
                    {t(`statuses.${p.status}`)}
                  </Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
