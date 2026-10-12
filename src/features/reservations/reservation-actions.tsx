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
import {
  RESERVATION_ACTIONS,
  type StaffReservationAction,
} from "@/shared/domain/reservation-status";

import { reservationActionAction } from "./actions";

/** Staff buttons for one reservation; decline and cancel ask for a reason the guest sees. */
export function ReservationActions({
  restaurantId,
  reservationId,
  guest,
  actions,
}: {
  restaurantId: string;
  reservationId: string;
  /** Guest name, for button labels ("Confirm Anna's reservation"). */
  guest: string;
  /** What this person may do now (from the shared rules). */
  actions: StaffReservationAction[];
}) {
  const t = useTranslations("StaffReservations.actions");
  const { busy, run } = useRun();
  const [asking, setAsking] = useState<StaffReservationAction | null>(null);
  const [reason, setReason] = useState("");
  if (actions.length === 0) return null;

  const primary = actions.filter((a) => !RESERVATION_ACTIONS[a].reasonRequired);
  const withReason = actions.filter((a) => RESERVATION_ACTIONS[a].reasonRequired);

  return (
    <div className="flex flex-wrap gap-2">
      {primary.map((step, i) => (
        <Button
          key={step}
          size="sm"
          variant={step === "no_show" ? "outline" : i === 0 ? "default" : "outline"}
          disabled={busy !== null}
          aria-label={t(`${step}Label`, { guest })}
          onClick={() =>
            run(step, () => reservationActionAction(restaurantId, reservationId, step))
          }
        >
          {busy === step && <Loader2 className="animate-spin" aria-hidden />}
          {t(step)}
        </Button>
      ))}
      {withReason.map((step) => (
        <Button
          key={step}
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={busy !== null}
          aria-label={t(`${step}Label`, { guest })}
          onClick={() => {
            setReason("");
            setAsking(step);
          }}
        >
          {t(step)}
        </Button>
      ))}

      <Dialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(asking === "decline" ? "declineTitle" : "cancelTitle", { guest })}
            </DialogTitle>
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
                const step = asking;
                if (
                  await run(step, () =>
                    reservationActionAction(restaurantId, reservationId, step, reason),
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
