"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useApiError } from "@/components/shared/use-api-error";
import { useFieldError } from "@/components/shared/use-field-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import type { RestaurantStatus } from "@/shared/constants/restaurants";
import type { ApiResult } from "@/shared/errors";
import { statusReasonSchema } from "@/shared/schemas/admin";

import {
  approveRestaurantAction,
  reinstateRestaurantAction,
  rejectRestaurantAction,
  suspendRestaurantAction,
} from "./actions";

type ReasonAction = "reject" | "suspend";

export function ReviewActions({
  restaurantId,
  status,
}: {
  restaurantId: string;
  status: RestaurantStatus;
}) {
  const t = useTranslations("Admin.review");
  const apiError = useApiError();
  const fieldError = useFieldError();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<ReasonAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();

  async function run(task: () => Promise<ApiResult<unknown>>, success: string) {
    setPending(true);
    const result = await task();
    setPending(false);
    if (result.error) {
      toast.error(apiError.message(result.error));
      return false;
    }
    toast.success(success);
    router.refresh();
    return true;
  }

  async function submitReason() {
    const parsed = statusReasonSchema.safeParse({ reason });
    if (!parsed.success) {
      setReasonError(parsed.error.issues[0]?.message);
      return;
    }
    const task =
      dialog === "reject"
        ? () => rejectRestaurantAction(restaurantId, { reason })
        : () => suspendRestaurantAction(restaurantId, { reason });
    if (await run(task, dialog === "reject" ? t("rejected") : t("suspended"))) {
      setDialog(null);
      setReason("");
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "pending_review" && (
        <>
          <Button
            disabled={pending}
            onClick={() => run(() => approveRestaurantAction(restaurantId), t("approved"))}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {t("approve")}
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => setDialog("reject")}>
            {t("reject")}
          </Button>
        </>
      )}
      {status === "active" && (
        <Button variant="destructive" disabled={pending} onClick={() => setDialog("suspend")}>
          {t("suspend")}
        </Button>
      )}
      {status === "suspended" && (
        <Button
          disabled={pending}
          onClick={() => run(() => reinstateRestaurantAction(restaurantId), t("reinstated"))}
        >
          {t("reinstate")}
        </Button>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "suspend" ? t("suspendTitle") : t("rejectTitle")}</DialogTitle>
            <DialogDescription>{t("reasonHint")}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={!!reasonError}>
            <FieldLabel htmlFor="status-reason">{t("reason")}</FieldLabel>
            <Textarea
              id="status-reason"
              rows={4}
              value={reason}
              aria-invalid={!!reasonError}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError(undefined);
              }}
            />
            <FieldError>{fieldError(reasonError)}</FieldError>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant={dialog === "suspend" ? "destructive" : "default"}
              disabled={pending}
              onClick={submitReason}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {dialog === "suspend" ? t("suspend") : t("reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
