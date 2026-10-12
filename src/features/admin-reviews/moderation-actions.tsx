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
import { type ModerationDecision, moderationRule } from "@/shared/domain/review-moderation";

import { moderateReviewAction } from "./actions";

/** Admin decisions for one review; hiding and rejecting need a reason. */
export function ModerationActions({
  reviewId,
  author,
  decisions,
}: {
  reviewId: string;
  author: string;
  decisions: ModerationDecision[];
}) {
  const t = useTranslations("AdminReviews");
  const { busy, run } = useRun();
  const [asking, setAsking] = useState<ModerationDecision | null>(null);
  const [reason, setReason] = useState("");

  return (
    <div className="flex flex-wrap gap-2">
      {decisions.map((decision) => (
        <Button
          key={decision}
          size="sm"
          variant={decision === "keep" ? "default" : "outline"}
          className={decision === "reject" ? "text-destructive" : undefined}
          disabled={busy !== null}
          aria-label={t(`${decision}Label`, { author })}
          onClick={() => {
            if (moderationRule(decision).reasonRequired) {
              setReason("");
              setAsking(decision);
            } else {
              void run(decision, () => moderateReviewAction(reviewId, decision), t("done"));
            }
          }}
        >
          {t(decision)}
        </Button>
      ))}
      <Dialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{asking && t(`${asking}Label`, { author })}</DialogTitle>
            <DialogDescription>{t("reasonHint")}</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label={t("reason")}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(null)}>
              {t("back")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null || reason.trim().length < 5}
              onClick={async () => {
                if (!asking) return;
                const decision = asking;
                if (
                  await run(
                    decision,
                    () => moderateReviewAction(reviewId, decision, reason),
                    t("done"),
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
