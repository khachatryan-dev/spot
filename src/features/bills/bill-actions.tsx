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

import { finalizeBillAction, voidBillAction } from "./actions";

/** Finalize an open bill; void an unpaid one (with a reason). */
export function BillActions({
  restaurantId,
  sessionId,
  billId,
  canFinalize,
  canVoid,
  tableNumber,
}: {
  restaurantId: string;
  sessionId: string;
  billId: string;
  canFinalize: boolean;
  canVoid: boolean;
  tableNumber: string;
}) {
  const t = useTranslations("Bill.actions");
  const { busy, run } = useRun();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  if (!canFinalize && !canVoid) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {canFinalize && (
        <Button
          disabled={busy !== null}
          onClick={() =>
            run("finalize", () => finalizeBillAction(restaurantId, sessionId), t("finalized"))
          }
        >
          {busy === "finalize" && <Loader2 className="animate-spin" aria-hidden />}
          {t("finalize")}
        </Button>
      )}
      {canVoid && (
        <Button
          variant="ghost"
          className="text-destructive"
          disabled={busy !== null}
          onClick={() => {
            setReason("");
            setAsking(true);
          }}
        >
          {t("void")}
        </Button>
      )}
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("voidTitle", { number: tableNumber })}</DialogTitle>
            <DialogDescription>{t("voidHint")}</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label={t("reason")}
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              {t("back")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null || reason.trim().length < 3}
              onClick={async () => {
                if (
                  await run("void", () => voidBillAction(restaurantId, billId, reason), t("voided"))
                )
                  setAsking(false);
              }}
            >
              {t("void")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
