"use client";

import { AlertTriangle, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useHydrated } from "@/features/customer-menu/cart-context";
import { cn } from "@/lib/utils";
import type { RestaurantPermission } from "@/shared/auth/permissions";
import type { OrderStatus } from "@/shared/constants/orders";
import { nextStatuses } from "@/shared/domain/order-status";

import { StatusActions } from "./status-actions";

export interface KitchenCardOrder {
  id: string;
  number: number;
  status: OrderStatus;
  tableNumber: string;
  submittedAt: string;
  note: string | null;
  lines: { id: string; name: string; quantity: number; note: string | null; options: string[] }[];
}

/** Steps that belong on the kitchen screen; serving and cancelling happen elsewhere. */
const KITCHEN_STEPS: OrderStatus[] = ["accepted", "preparing", "ready", "rejected"];
const WARN_MINUTES = 10;
const LATE_MINUTES = 20;

function useMinutesSince(iso: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/** Large, glanceable tickets for a kitchen tablet (§17). */
export function KitchenBoard({
  restaurantId,
  queue,
  ready,
  permissions,
}: {
  restaurantId: string;
  queue: KitchenCardOrder[];
  ready: KitchenCardOrder[];
  permissions: RestaurantPermission[];
}) {
  const t = useTranslations("Kitchen");
  return (
    <div className="flex flex-col gap-6">
      {queue.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-10 text-center text-lg text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("queue")}>
          {queue.map((order) => (
            <li key={order.id}>
              <Ticket order={order} restaurantId={restaurantId} permissions={permissions} />
            </li>
          ))}
        </ul>
      )}
      {ready.length > 0 && (
        <section aria-labelledby="ready-title" className="flex flex-col gap-2">
          <h2 id="ready-title" className="text-sm font-semibold text-muted-foreground">
            {t("readyTitle")}
          </h2>
          <ul className="flex flex-wrap gap-2" aria-label={t("readyTitle")}>
            {ready.map((order) => (
              <li
                key={order.id}
                className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium"
              >
                {t("readyChip", { table: order.tableNumber, number: order.number })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Ticket({
  order,
  restaurantId,
  permissions,
}: {
  order: KitchenCardOrder;
  restaurantId: string;
  permissions: RestaurantPermission[];
}) {
  const t = useTranslations("Kitchen");
  const hydrated = useHydrated();
  const minutes = useMinutesSince(order.submittedAt);
  const urgency = !hydrated
    ? "normal"
    : minutes >= LATE_MINUTES
      ? "late"
      : minutes >= WARN_MINUTES
        ? "warn"
        : "normal";
  const next = nextStatuses(order.status, (p) => permissions.includes(p)).filter((s) =>
    KITCHEN_STEPS.includes(s),
  );

  return (
    <article
      aria-label={t("ticketLabel", { table: order.tableNumber, number: order.number })}
      className={cn(
        "flex h-full flex-col gap-3 rounded-2xl border-2 bg-background p-4",
        urgency === "warn" && "border-amber-500",
        urgency === "late" && "border-destructive",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-3xl leading-none font-bold">
            {t("table", { table: order.tableNumber })}
          </span>
          <span className="text-sm text-muted-foreground">
            #{order.number} · {t(`status.${order.status}`)}
          </span>
        </div>
        <span
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-1 text-sm font-semibold tabular-nums",
            urgency === "normal" && "bg-muted",
            urgency === "warn" &&
              "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
            urgency === "late" && "bg-destructive text-white",
          )}
        >
          {urgency !== "normal" && <AlertTriangle className="size-4" aria-hidden />}
          {hydrated ? t("minutes", { minutes }) : "—"}
          {urgency === "late" && <span className="sr-only">{t("late")}</span>}
        </span>
      </header>
      <ul className="flex flex-col gap-2 text-lg">
        {order.lines.map((line) => (
          <li key={line.id}>
            <span className="font-bold">{line.quantity} ×</span> {line.name}
            {line.options.length > 0 && (
              <span className="block text-base text-muted-foreground">
                {line.options.join(", ")}
              </span>
            )}
            {line.note && (
              <span className="mt-1 flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-base font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                <MessageSquare className="size-4 shrink-0" aria-hidden />
                {line.note}
              </span>
            )}
          </li>
        ))}
      </ul>
      {order.note && <p className="rounded-md border border-dashed p-2 text-sm">{order.note}</p>}
      <div className="mt-auto">
        <StatusActions
          restaurantId={restaurantId}
          orderId={order.id}
          number={order.number}
          next={next}
        />
      </div>
    </article>
  );
}
