"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/features/menu-editor/use-run";

import { deleteMyReviewAction, updateMyReviewAction } from "./actions";
import { StarRatingInput } from "./star-rating-input";
import { Stars } from "./stars";

/** One of the signed-in guest's reviews, with edit and delete. */
export function MyReview({
  review,
}: {
  review: {
    id: string;
    restaurantName: string;
    rating: number;
    comment: string | null;
    status: "pending" | "published" | "hidden" | "rejected";
    response: string | null;
  };
}) {
  const t = useTranslations("Reviews");
  const { busy, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(review.rating);
  const [comment, setComment] = useState(review.comment ?? "");
  const editable = review.status === "published" || review.status === "pending";

  return (
    <li className="flex flex-col gap-2 rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{review.restaurantName}</span>
        {review.status !== "published" && (
          <Badge variant="outline">{t(`status.${review.status}`)}</Badge>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <StarRatingInput name={`edit-${review.id}`} value={rating} onChange={setRating} />
          <Textarea
            aria-label={t("commentLabel")}
            rows={3}
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={async () => {
                if (
                  await run(
                    "save",
                    () => updateMyReviewAction(review.id, { rating, comment }),
                    t("saved"),
                  )
                )
                  setEditing(false);
              }}
            >
              {t("save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Stars rating={review.rating} label={t("ratingOf", { rating: review.rating })} />
          {review.comment && <p className="text-sm whitespace-pre-line">{review.comment}</p>}
          {review.response && (
            <p className="rounded-lg bg-muted/50 p-2 text-sm">
              <span className="font-medium">{t("responseLabel")}</span> {review.response}
            </p>
          )}
          <div className="flex gap-2">
            {editable && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                {t("edit")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm(t("deleteConfirm", { restaurant: review.restaurantName })))
                  void run("delete", () => deleteMyReviewAction(review.id), t("deleted"));
              }}
            >
              {t("delete")}
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
