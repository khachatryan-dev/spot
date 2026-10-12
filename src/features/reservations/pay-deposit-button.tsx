"use client";

import { CreditCard, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useApiError } from "@/components/shared/use-api-error";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

import { payDepositAction } from "./actions";

/** Sends the guest to the payment page for their booking's deposit. */
export function PayDepositButton({
  reservationId,
  amount,
}: {
  reservationId: string;
  amount: string;
}) {
  const t = useTranslations("Reservations");
  const apiError = useApiError();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function pay() {
    setBusy(true);
    const result = await payDepositAction(reservationId);
    if (result.error) {
      setBusy(false);
      toast.error(apiError.message(result.error));
      router.refresh();
      return;
    }
    if (result.data.redirectUrl) window.location.assign(result.data.redirectUrl);
    else router.refresh(); // already paid
  }

  return (
    <Button size="sm" className="self-start" disabled={busy} onClick={pay}>
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <CreditCard aria-hidden />}
      {t("payDeposit", { amount })}
    </Button>
  );
}
