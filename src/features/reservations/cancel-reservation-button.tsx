"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useRun } from "@/features/menu-editor/use-run";

import { cancelMyReservationAction } from "./actions";

/** Shown on the guest's own booking until it starts. */
export function CancelReservationButton({
  reservationId,
  restaurant,
  depositNote,
}: {
  reservationId: string;
  restaurant: string;
  /** What happens to a paid deposit if they cancel now. */
  depositNote?: string;
}) {
  const t = useTranslations("Reservations");
  const { busy, run } = useRun();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="self-start text-destructive"
      disabled={busy !== null}
      aria-label={t("cancelLabel", { restaurant })}
      onClick={() => {
        const question = t("cancelConfirm", { restaurant });
        if (window.confirm(depositNote ? `${question}\n\n${depositNote}` : question))
          void run("cancel", () => cancelMyReservationAction(reservationId), t("cancelled"));
      }}
    >
      {t("cancel")}
    </Button>
  );
}
