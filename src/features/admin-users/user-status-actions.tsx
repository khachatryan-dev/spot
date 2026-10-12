"use client";

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

import { setUserStatusAction } from "./actions";

/** Suspend (with a reason) or restore one account. */
export function UserStatusActions({
  userId,
  who,
  status,
}: {
  userId: string;
  who: string;
  status: "active" | "suspended";
}) {
  const t = useTranslations("AdminUsers");
  const { busy, run } = useRun();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");

  if (status === "suspended") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy !== null}
        aria-label={t("restoreLabel", { who })}
        onClick={() => run("restore", () => setUserStatusAction(userId, "active"), t("restored"))}
      >
        {t("restore")}
      </Button>
    );
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="text-destructive"
        aria-label={t("suspendLabel", { who })}
        onClick={() => {
          setReason("");
          setAsking(true);
        }}
      >
        {t("suspend")}
      </Button>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("suspendLabel", { who })}</DialogTitle>
            <DialogDescription>{t("suspendHint")}</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label={t("reason")}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              {t("back")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null || reason.trim().length < 5}
              onClick={async () => {
                if (
                  await run(
                    "suspend",
                    () => setUserStatusAction(userId, "suspended", reason),
                    t("suspended"),
                  )
                )
                  setAsking(false);
              }}
            >
              {t("suspend")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
