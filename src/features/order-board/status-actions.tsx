"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/features/menu-editor/use-run";
import type { OrderStatus } from "@/shared/constants/orders";

import { changeOrderStatusAction } from "./actions";

/** Forward steps first; reject/cancel last, behind a reason dialog. */
const ORDER: OrderStatus[] = [
  "accepted",
  "preparing",
  "ready",
  "served",
  "completed",
  "received",
  "rejected",
  "cancelled",
];
const NEEDS_REASON: OrderStatus[] = ["rejected", "cancelled"];

export function StatusActions({
  restaurantId,
  orderId,
  number,
  next,
}: {
  restaurantId: string;
  orderId: string;
  number: number;
  /** Statuses this person may move the order to (from the shared rules). */
  next: OrderStatus[];
}) {
  const t = useTranslations("OrderBoard.actions");
  const { busy, run } = useRun();
  const [asking, setAsking] = useState<OrderStatus | null>(null);
  const [reason, setReason] = useState("");
  const steps = ORDER.filter((s) => next.includes(s) && s !== "received");
  if (steps.length === 0) return null;

  const primary = steps.filter((s) => !NEEDS_REASON.includes(s));
  const destructive = steps.filter((s) => NEEDS_REASON.includes(s));

  return (
    <div className="flex flex-wrap gap-2">
      {primary.map((to, i) => (
        <Button
          key={to}
          size="sm"
          variant={i === 0 ? "default" : "outline"}
          disabled={busy !== null}
          aria-label={t(`${to}Label`, { number })}
          onClick={() => run(to, () => changeOrderStatusAction(restaurantId, orderId, to))}
        >
          {busy === to && <Loader2 className="animate-spin" aria-hidden />}
          {t(to)}
        </Button>
      ))}
      {destructive.map((to) => (
        <Button
          key={to}
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={busy !== null}
          aria-label={t(`${to}Label`, { number })}
          onClick={() => {
            setReason("");
            setAsking(to);
          }}
        >
          {t(to)}
        </Button>
      ))}

      <Dialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{asking && t(`${asking}Title`, { number })}</DialogTitle>
            <DialogDescription>{t("reasonHint")}</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label={t("reason")}
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(null)}>
              {t("back")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null || reason.trim().length < 3}
              onClick={async () => {
                if (!asking) return;
                if (
                  await run(asking, () =>
                    changeOrderStatusAction(restaurantId, orderId, asking, reason),
                  )
                )
                  setAsking(null);
              }}
            >
              {asking && t(asking)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
