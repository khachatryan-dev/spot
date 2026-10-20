import { ArrowLeft, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { LiveRefresh } from "@/features/ordering/live-refresh";
import { CancelOrderButton } from "@/features/ordering/cancel-order-button";
import { OrderProgress } from "@/features/ordering/order-progress";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getCustomer } from "@/server/guests/current-customer";
import { getCustomerOrders } from "@/server/services/order-service";
import { TABLE_COOKIE } from "@/server/table-sessions/table-cookie";
import type { OrderStatus } from "@/shared/constants/orders";
import { CUSTOMER_CANCELLABLE } from "@/shared/domain/order-status";
import { formatMoney } from "@/shared/utils/money";
import { realtimeChannels } from "@/server/realtime/channels";
import { isRealtimeEnabled } from "@/server/realtime/realtime";

export async function generateMetadata(): Promise<Metadata> {
  return { robots: { index: false } };
}

const DONE: OrderStatus[] = ["completed", "cancelled", "rejected"];

/** The guest's own orders in this table visit, with live-ish status. */
export default async function MyOrdersPage({
  params,
  searchParams,
}: PageProps<"/[locale]/table/orders">) {
  const locale = await resolveLocale(params);
  const { placed } = await searchParams;
  const customer = await getCustomer();
  const sessionId = (await cookies()).get(TABLE_COOKIE)?.value;
  const orders = customer ? await getCustomerOrders(customer, sessionId) : null;
  const t = await getTranslations("Orders");
  const format = await getFormatter();

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        href="/table"
        className="flex items-center gap-1 self-start text-sm text-muted-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      {typeof placed === "string" && orders?.some((o) => o.id === placed) && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-medium text-emerald-900 ring-1 ring-emerald-100 motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50"
        >
          <CheckCircle2 className="size-6 text-emerald-700 dark:text-emerald-300" aria-hidden />
          {t("placed")}
        </p>
      )}

      {!orders || orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3" aria-label={t("title")}>
            {orders.map((order) => (
              <li
                key={order.id}
                className="flex flex-col gap-3 rounded-3xl border bg-card p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{t("number", { number: order.number })}</span>
                  <Badge variant={DONE.includes(order.status) ? "outline" : "default"}>
                    {t(`status.${order.status}`)}
                  </Badge>
                </div>
                <OrderProgress status={order.status} />
                <span className="text-xs text-muted-foreground">
                  {format.dateTime(order.submittedAt, { hour: "2-digit", minute: "2-digit" })}
                </span>
                <ul className="flex flex-col gap-1 text-sm">
                  {order.lines.map((line) => (
                    <li key={line.id} className="flex justify-between gap-3">
                      <span>
                        {line.quantity} × {line.name}
                        {line.options.length > 0 && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {line.options.join(", ")}
                          </span>
                        )}
                        {line.note && (
                          <span className="block text-xs text-muted-foreground italic">
                            “{line.note}”
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums">
                        {formatMoney(line.lineTotalMinor, order.currency, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
                {order.note && (
                  <p className="text-xs text-muted-foreground">{t("note", { note: order.note })}</p>
                )}
                {order.cancelReason &&
                  (order.status === "rejected" || order.status === "cancelled") && (
                    <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                      {t("reasonLabel", { reason: order.cancelReason })}
                    </p>
                  )}
                {CUSTOMER_CANCELLABLE.includes(order.status) && (
                  <CancelOrderButton orderId={order.id} number={order.number} />
                )}
                <div className="flex justify-between border-t pt-2 font-semibold">
                  <span>{t("total")}</span>
                  <span className="tabular-nums">
                    {formatMoney(order.totalMinor, order.currency, locale)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {orders.some((o) => !DONE.includes(o.status)) && (
            <>
              <p className="text-center text-xs text-muted-foreground">{t("autoRefresh")}</p>
              <LiveRefresh
                channel={realtimeChannels.session(sessionId!)}
                enabled={isRealtimeEnabled()}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
