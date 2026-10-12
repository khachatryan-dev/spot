"use client";

import { Receipt } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRun } from "@/features/menu-editor/use-run";
import { Link } from "@/i18n/navigation";

import { closeTableSessionAction } from "./actions";

export interface ActiveSessionInfo {
  sessionId: string;
  code: string;
  openedAt: Date;
  memberCount: number;
}

/** "Occupied · 3 guests · #K7M2QX · 19:05" with an optional Close button. */
export function ActiveSessionBadge({
  restaurantId,
  tableNumber,
  session,
  canClose,
  canSeeBill = false,
}: {
  restaurantId: string;
  tableNumber: string;
  session: ActiveSessionInfo;
  canClose: boolean;
  canSeeBill?: boolean;
}) {
  const t = useTranslations("Tables.session");
  const format = useFormatter();
  const { busy, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge>{t("occupied")}</Badge>
      <span className="text-muted-foreground">
        {t("guests", { count: session.memberCount })} · #{session.code} ·{" "}
        {format.dateTime(session.openedAt, { hour: "2-digit", minute: "2-digit" })}
      </span>
      {canSeeBill && (
        <Button
          size="sm"
          variant="outline"
          aria-label={t("billFor", { number: tableNumber })}
          render={<Link href={`/dashboard/r/${restaurantId}/bills/${session.sessionId}`} />}
        >
          <Receipt aria-hidden />
          {t("bill")}
        </Button>
      )}
      {canClose && (
        <Button
          size="sm"
          variant="outline"
          aria-label={t("closeFor", { number: tableNumber })}
          disabled={busy !== null}
          onClick={() => {
            if (window.confirm(t("closeConfirm", { number: tableNumber }))) {
              void run(
                session.sessionId,
                () => closeTableSessionAction(restaurantId, session.sessionId),
                t("closed"),
              );
            }
          }}
        >
          {t("close")}
        </Button>
      )}
    </div>
  );
}
