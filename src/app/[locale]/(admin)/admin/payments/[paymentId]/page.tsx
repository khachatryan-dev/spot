import { ArrowLeft } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requirePlatformPermission } from "@/server/auth/guards";
import { getPaymentDetail } from "@/server/services/admin-payment-service";
import { formatMoney } from "@/shared/utils/money";

/** One payment: provider reference, history, refunds and what it paid for. */
export default async function AdminPaymentPage({
  params,
}: PageProps<"/[locale]/admin/payments/[paymentId]">) {
  const locale = await resolveLocale(params);
  const { paymentId } = await params;
  const { payment, events, refunds, billId } = await guardPage(locale, async () =>
    getPaymentDetail(await requirePlatformPermission("platform:payments:read"), paymentId),
  );
  const t = await getTranslations("AdminPayments");
  const format = await getFormatter();
  const money = (minor: number) => formatMoney(minor, payment.currency, locale);
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "medium" });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link
        href="/admin/payments"
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tabular-nums">{money(payment.amountMinor)}</h1>
        <Badge>{t(`statuses.${payment.status}`)}</Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t("restaurant")}</dt>
        <dd>
          <Link
            href={{ pathname: "/admin/payments", query: { restaurant: payment.restaurantId } }}
            className="underline-offset-4 hover:underline"
          >
            {payment.restaurantName}
          </Link>
        </dd>
        <dt className="text-muted-foreground">{t("purpose")}</dt>
        <dd>
          {t(`purposes.${payment.purpose}`)}
          {payment.reservationId && (
            <> · {t("reservationRef", { id: payment.reservationId.slice(0, 8) })}</>
          )}
          {billId && <> · {t("billRef", { id: billId.slice(0, 8) })}</>}
        </dd>
        <dt className="text-muted-foreground">{t("provider")}</dt>
        <dd>
          {payment.provider}
          {payment.providerPaymentId && (
            <span className="text-muted-foreground"> · {payment.providerPaymentId}</span>
          )}
        </dd>
        <dt className="text-muted-foreground">{t("created")}</dt>
        <dd>{when(payment.createdAt)}</dd>
        {payment.refundedMinor > 0 && (
          <>
            <dt className="text-muted-foreground">{t("totals.refunded")}</dt>
            <dd className="tabular-nums">{money(payment.refundedMinor)}</dd>
          </>
        )}
        {payment.failureReason && (
          <>
            <dt className="text-muted-foreground">{t("failure")}</dt>
            <dd>{payment.failureReason}</dd>
          </>
        )}
      </dl>

      <section aria-labelledby="history-heading" className="flex flex-col gap-2">
        <h2 id="history-heading" className="text-lg font-semibold">
          {t("history")}
        </h2>
        <ol className="flex flex-col gap-1 border-l pl-4 text-sm">
          {events.map((e) => (
            <li key={e.id}>
              <span className="font-medium">{e.type}</span>
              {e.fromStatus && e.toStatus && (
                <span className="text-muted-foreground">
                  {" "}
                  · {e.fromStatus} → {e.toStatus}
                </span>
              )}
              {e.amountMinor !== null && (
                <span className="tabular-nums"> · {money(e.amountMinor)}</span>
              )}
              <span className="block text-xs text-muted-foreground">{when(e.createdAt)}</span>
            </li>
          ))}
        </ol>
      </section>

      {refunds.length > 0 && (
        <section aria-labelledby="refunds-heading" className="flex flex-col gap-2">
          <h2 id="refunds-heading" className="text-lg font-semibold">
            {t("refunds")}
          </h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {refunds.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 p-3">
                <span>
                  {r.reason}
                  <span className="block text-xs text-muted-foreground">{when(r.createdAt)}</span>
                </span>
                <span className="tabular-nums">
                  {money(r.amountMinor)} · {t(`refundStatuses.${r.status}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
