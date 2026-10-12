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

import { reportReviewAction, respondToReviewAction } from "./actions";

/** The restaurant's reply to one review, and the "report" button. */
export function ReviewReply({
  restaurantId,
  reviewId,
  guest,
  response,
  canReply,
  reported,
}: {
  restaurantId: string;
  reviewId: string;
  guest: string;
  response: string | null;
  canReply: boolean;
  reported: boolean;
}) {
  const t = useTranslations("RestaurantReviews");
  const { busy, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(response ?? "");
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="flex flex-col gap-2">
      {response && !editing && (
        <p className="rounded-lg bg-muted/50 p-2 text-sm">
          <span className="font-medium">{t("yourReply")}</span> {response}
        </p>
      )}
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label={t("replyLabel", { guest })}
            rows={3}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy !== null || text.trim() === ""}
              onClick={async () => {
                if (
                  await run(
                    "reply",
                    () => respondToReviewAction(restaurantId, reviewId, text),
                    t("replied"),
                  )
                )
                  setEditing(false);
              }}
            >
              {t("publishReply")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canReply && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {response ? t("editReply") : t("reply")}
            </Button>
          )}
          {canReply && response && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                setText("");
                void run(
                  "remove",
                  () => respondToReviewAction(restaurantId, reviewId, ""),
                  t("removed"),
                );
              }}
            >
              {t("removeReply")}
            </Button>
          )}
          {!reported && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                setReason("");
                setReporting(true);
              }}
            >
              {t("report")}
            </Button>
          )}
        </div>
      )}
      <Dialog open={reporting} onOpenChange={setReporting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reportTitle", { guest })}</DialogTitle>
            <DialogDescription>{t("reportHint")}</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label={t("reportReason")}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReporting(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null || reason.trim().length < 10}
              onClick={async () => {
                if (
                  await run(
                    "report",
                    () => reportReviewAction(restaurantId, reviewId, reason),
                    t("reported"),
                  )
                )
                  setReporting(false);
              }}
            >
              {t("report")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
