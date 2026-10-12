"use client";

import { BellRing, GlassWater, Receipt, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useRun } from "@/features/menu-editor/use-run";
import { cn } from "@/lib/utils";
import type { TableRequestStatus, TableRequestType } from "@/shared/constants/table-requests";

import { cancelServiceRequestAction, requestServiceAction } from "./actions";

const BUTTONS: { type: TableRequestType; icon: typeof BellRing }[] = [
  { type: "waiter", icon: BellRing },
  { type: "bill", icon: Receipt },
  { type: "water", icon: GlassWater },
];

/** Guest-side service buttons (§18) with the status of each open request. */
export function RequestButtons({
  open,
}: {
  open: { id: string; type: TableRequestType; status: TableRequestStatus }[];
}) {
  const t = useTranslations("TableRequests");
  const { busy, run } = useRun();

  return (
    <section aria-label={t("title")} className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {BUTTONS.map(({ type, icon: Icon }) => {
          const request = open.find((r) => r.type === type);
          return (
            <Button
              key={type}
              variant={request ? "default" : "outline"}
              className={cn("h-auto flex-col gap-1 py-3 text-xs", request && "pointer-events-none")}
              aria-pressed={!!request}
              disabled={busy !== null && !request}
              onClick={() => !request && run(type, () => requestServiceAction(type), t("sent"))}
            >
              <Icon className="size-5" aria-hidden />
              {t(`types.${type}`)}
            </Button>
          );
        })}
      </div>
      {open.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t("openTitle")}>
          {open.map((request) => (
            <li
              key={request.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
              role="status"
            >
              <span>
                {t(`types.${request.type}`)} · <strong>{t(`status.${request.status}`)}</strong>
              </span>
              {request.status === "pending" && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("cancel", { type: t(`types.${request.type}`) })}
                  disabled={busy !== null}
                  onClick={() => run(request.id, () => cancelServiceRequestAction(request.id))}
                >
                  <X aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
