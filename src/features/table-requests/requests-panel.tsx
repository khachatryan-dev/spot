"use client";

import { BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/features/customer-menu/cart-context";
import { useRun } from "@/features/menu-editor/use-run";
import type { TableRequestStatus, TableRequestType } from "@/shared/constants/table-requests";

import { updateServiceRequestAction } from "./actions";

export interface PanelRequest {
  id: string;
  type: TableRequestType;
  status: TableRequestStatus;
  note: string | null;
  tableNumber: string;
  createdAt: string;
}

/** Staff panel of open table requests, oldest first (§18). */
export function RequestsPanel({
  restaurantId,
  requests,
}: {
  restaurantId: string;
  requests: PanelRequest[];
}) {
  const t = useTranslations("TableRequests");
  const { busy, run } = useRun();
  const hydrated = useHydrated();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (requests.length === 0) return null;

  return (
    <section
      aria-labelledby="requests-title"
      className="flex flex-col gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 p-3"
    >
      <h2 id="requests-title" className="flex items-center gap-2 text-sm font-semibold">
        <BellRing className="size-4" aria-hidden />
        {t("panelTitle", { count: requests.length })}
      </h2>
      <ul className="flex flex-col gap-2" aria-label={t("panelTitle", { count: requests.length })}>
        {requests.map((request) => {
          const minutes = Math.max(
            0,
            Math.floor((now - new Date(request.createdAt).getTime()) / 60_000),
          );
          return (
            <li
              key={request.id}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-background p-2"
            >
              <span className="font-semibold">{t("table", { table: request.tableNumber })}</span>
              <Badge variant={request.type === "bill" ? "default" : "secondary"}>
                {t(`types.${request.type}`)}
              </Badge>
              {request.status === "acknowledged" && (
                <span className="text-xs text-muted-foreground">{t("status.acknowledged")}</span>
              )}
              {hydrated && (
                <span className="text-xs text-muted-foreground">
                  {t("minutesAgo", { minutes })}
                </span>
              )}
              {request.note && <span className="w-full text-xs italic">“{request.note}”</span>}
              <div className="ml-auto flex gap-1">
                {request.status === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    aria-label={t("acknowledgeFor", {
                      table: request.tableNumber,
                      type: t(`types.${request.type}`),
                    })}
                    onClick={() =>
                      run(request.id, () =>
                        updateServiceRequestAction(restaurantId, request.id, "acknowledged"),
                      )
                    }
                  >
                    {t("acknowledge")}
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={busy !== null}
                  aria-label={t("completeFor", {
                    table: request.tableNumber,
                    type: t(`types.${request.type}`),
                  })}
                  onClick={() =>
                    run(request.id, () =>
                      updateServiceRequestAction(restaurantId, request.id, "completed"),
                    )
                  }
                >
                  {t("complete")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
