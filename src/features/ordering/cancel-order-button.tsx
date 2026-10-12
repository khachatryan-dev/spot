"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useRun } from "@/features/menu-editor/use-run";

import { cancelMyOrderAction } from "./actions";

/** Shown while the kitchen hasn't accepted the order yet. */
export function CancelOrderButton({ orderId, number }: { orderId: string; number: number }) {
  const t = useTranslations("Orders");
  const { busy, run } = useRun();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="self-start text-destructive"
      disabled={busy !== null}
      onClick={() => {
        if (window.confirm(t("cancelConfirm", { number })))
          void run("cancel", () => cancelMyOrderAction(orderId), t("cancelled"));
      }}
    >
      {t("cancel")}
    </Button>
  );
}
