"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useApiError } from "@/components/shared/use-api-error";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

import { acceptInvitationAction } from "./actions";

export function AcceptInvitationButton({ token }: { token: string }) {
  const t = useTranslations("Staff.accept");
  const apiError = useApiError();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function accept() {
    setPending(true);
    const result = await acceptInvitationAction(token);
    if (result.error) {
      setPending(false);
      toast.error(apiError.message(result.error));
      return;
    }
    router.replace(`/dashboard/r/${result.data.restaurantId}`);
  }

  return (
    <Button onClick={accept} disabled={pending} className="w-full">
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {t("button")}
    </Button>
  );
}
