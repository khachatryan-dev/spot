"use client";

import { Clock, MessageSquare } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { useHydrated } from "@/features/customer-menu/cart-context";
import { cn } from "@/lib/utils";
import type { RestaurantPermission } from "@/shared/auth/permissions";
import type { OrderStatus } from "@/shared/constants/orders";
import { nextStatuses } from "@/shared/domain/order-status";
import { formatMoney } from "@/shared/utils/money";

import { StatusActions } from "./status-actions";

export interface BoardOrder {
  id: string;
  number: number;
  status: OrderStatus;
  tableNumber: string;
  submittedAt: string;
  totalMinor: number;
  currency: string;
  note: string | null;
  lines: { id: string; name: string; quantity: number; note: string | null; options: string[] }[];
}

const COLUMNS: { key: "new" | "inProgress" | "ready" | "served"; statuses: OrderStatus[] }[] = [
  { key: "new", statuses: ["submitted", "received"] },
  { key: "inProgress", statuses: ["accepted", "preparing"] },
  { key: "ready", statuses: ["ready"] },
  { key: "served", statuses: ["served"] },
];

/** Re-render every 30s so "x min ago" stays current. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Order board: oldest first in each column; fresh orders stand out (§35). */
export function OrderBoard({
  orders,
  restaurantId,
  permissions,
}: {
  orders: BoardOrder[];
  restaurantId: string;
  /** What this person may do; buttons follow the shared status rules. */
  permissions: RestaurantPermission[];
}) {
  const t = useTranslations("OrderBoard");
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((column) => {
        const inColumn = orders.filter((o) => column.statuses.includes(o.status));
        return (
          <section
            key={column.key}
            aria-labelledby={`col-${column.key}`}
            className="flex flex-col gap-3 rounded-2xl bg-muted/40 p-3"
          >
            <h2
              id={`col-${column.key}`}
              className="flex items-center justify-between text-sm font-semibold"
            >
              {t(`columns.${column.key}`)}
              <span className="rounded-full bg-background px-2 text-xs">{inColumn.length}</span>
            </h2>
            {inColumn.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">{t("emptyColumn")}</p>
            ) : (
              <ul className="flex flex-col gap-3" aria-label={t(`columns.${column.key}`)}>
                {inColumn.map((order) => (
                  <li key={order.id}>
                    <OrderCard
                      order={order}
                      restaurantId={restaurantId}
                      permissions={permissions}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function OrderCard({
  order,
  restaurantId,
  permissions,
}: {
  order: BoardOrder;
  restaurantId: string;
  permissions: RestaurantPermission[];
}) {
  const t = useTranslations("OrderBoard");
  const locale = useLocale();
  const format = useFormatter();
  const hydrated = useHydrated();
  const now = useNow();
  const submitted = new Date(order.submittedAt);
  const minutes = Math.max(0, Math.floor((now - submitted.getTime()) / 60_000));
  const fresh = hydrated && minutes < 2;

  return (
    <article
      aria-label={t("orderLabel", { number: order.number, table: order.tableNumber })}
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-background p-3 shadow-xs",
        fresh && "border-primary ring-2 ring-primary/30",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-lg font-bold">{t("table", { table: order.tableNumber })}</span>
          <span className="text-xs text-muted-foreground">#{order.number}</span>
        </div>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" aria-hidden />
          {hydrated
            ? t("minutesAgo", { minutes })
            : format.dateTime(submitted, { hour: "2-digit", minute: "2-digit" })}
        </span>
      </header>
      {fresh && <Badge className="self-start">{t("new")}</Badge>}
      <ul className="flex flex-col gap-1 text-sm">
        {order.lines.map((line) => (
          <li key={line.id}>
            <span className="font-medium">{line.quantity} ×</span> {line.name}
            {line.options.length > 0 && (
              <span className="text-muted-foreground"> · {line.options.join(", ")}</span>
            )}
            {line.note && (
              <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                <MessageSquare className="size-3" aria-hidden />
                {line.note}
              </span>
            )}
          </li>
        ))}
      </ul>
      {order.note && (
        <p className="rounded-md bg-amber-50 p-2 text-xs dark:bg-amber-950/40">{order.note}</p>
      )}
      <StatusActions
        restaurantId={restaurantId}
        orderId={order.id}
        number={order.number}
        next={nextStatuses(order.status, (p) => permissions.includes(p))}
      />
      <footer className="flex justify-between border-t pt-2 text-sm">
        <span className="text-muted-foreground">{t(`status.${order.status}`)}</span>
        <span className="font-semibold tabular-nums">
          {formatMoney(order.totalMinor, order.currency, locale)}
        </span>
      </footer>
    </article>
  );
}
