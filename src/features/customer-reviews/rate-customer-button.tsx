"use client";

import { Star } from "lucide-react";
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
import { StarRatingInput } from "@/features/reviews/star-rating-input";
import type { CustomerReviewTarget } from "@/server/services/customer-review-service";
import { MAX_CUSTOMER_REVIEW_COMMENT } from "@/shared/constants/customer-reviews";

import { rateCustomerAction } from "./actions";

/** "Rate guest" — stars and a short note the guest will see in their profile. */
export function RateCustomerButton({
  restaurantId,
  target,
  guest,
  given,
}: {
  restaurantId: string;
  target: CustomerReviewTarget;
  guest: string;
  /** The rating already given for this visit, to edit. */
  given?: { rating: number; comment: string | null };
}) {
  const t = useTranslations("CustomerReviews");
  const { busy, run } = useRun();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | undefined>(given?.rating);
  const [comment, setComment] = useState(given?.comment ?? "");
  const id = `rate-${"reservationId" in target ? target.reservationId : `${target.tableSessionId}-${target.customerUserId}`}`;

  async function save() {
    if (!rating) return;
    const done = await run(
      "save",
      () => rateCustomerAction(restaurantId, target, { rating, comment }),
      t("saved"),
    );
    if (done) setOpen(false);
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        aria-label={t(given ? "editLabel" : "rateLabel", { guest })}
        onClick={() => setOpen(true)}
      >
        <Star aria-hidden className={given ? "fill-amber-400 text-amber-500" : undefined} />
        {given ? t("edit", { rating: given.rating }) : t("rate")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title", { guest })}</DialogTitle>
            <DialogDescription>{t("visibility")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <StarRatingInput name={id} value={rating} onChange={setRating} />
            <label className="flex flex-col gap-1 text-sm">
              {t("comment")}
              <Textarea
                rows={3}
                maxLength={MAX_CUSTOMER_REVIEW_COMMENT}
                placeholder={t("commentPlaceholder")}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={!rating || busy !== null}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
