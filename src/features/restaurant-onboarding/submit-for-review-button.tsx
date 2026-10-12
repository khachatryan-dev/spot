"use client";

import { Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useApiError } from "@/components/shared/use-api-error";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

import { submitForReviewAction } from "./actions";

export function SubmitForReviewButton({
  restaurantId,
  disabled,
}: {
  restaurantId: string;
  disabled: boolean;
}) {
  const t = useTranslations("Onboarding.submit");
  const apiError = useApiError();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    const result = await submitForReviewAction(restaurantId);
    setPending(false);
    if (result.error) {
      toast.error(apiError.message(result.error));
      return;
    }
    toast.success(t("success"));
    router.refresh();
  }

  return (
    <Button onClick={onClick} disabled={disabled || pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
      {t("button")}
    </Button>
  );
}
