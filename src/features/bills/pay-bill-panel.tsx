"use client";

import { Loader2, Users, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useApiError } from "@/components/shared/use-api-error";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import type { BillPaymentRequest } from "@/server/services/bill-payment-service";

import { payBillAction } from "./actions";
import { ItemPicker, type PickerProps } from "./item-picker";

export interface PayOptions {
  billId: string;
  remaining: string;
  /** The equal split in use: free shares with their amounts. */
  split: { count: number; free: { index: number; amount: string }[] } | null;
  /** Ways a new equal split could go, with the amount of one share. */
  splitChoices: { count: number; amount: string }[];
  /** Pay by lines (null while the bill is split equally). */
  picker: Omit<PickerProps, "onPay" | "busy" | "payLabel"> | null;
}

/** How the guest pays: the rest, an equal share, or their own items (§23). */
export function PayBillPanel({ options }: { options: PayOptions }) {
  const t = useTranslations("Bill.pay");
  const apiError = useApiError();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [ways, setWays] = useState<number | null>(options.split?.count ?? null);

  async function pay(key: string, request: BillPaymentRequest) {
    setBusy(key);
    const result = await payBillAction(options.billId, request);
    if (result.error) {
      setBusy(null);
      toast.error(apiError.message(result.error));
      router.refresh();
      return;
    }
    if (result.data.redirectUrl) window.location.assign(result.data.redirectUrl);
    else router.refresh();
  }

  const spinner = (key: string) =>
    busy === key ? <Loader2 className="animate-spin" aria-hidden /> : null;
  const shares =
    options.split?.free ??
    (ways
      ? Array.from({ length: ways }, (_, i) => ({
          index: i + 1,
          amount: options.splitChoices.find((c) => c.count === ways)!.amount,
        }))
      : []);

  return (
    <section
      aria-labelledby="pay-heading"
      className="flex flex-col gap-4 rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border"
    >
      <h2 id="pay-heading" className="text-lg font-bold">
        {t("title", { amount: options.remaining })}
      </h2>
      <Button
        size="lg"
        className="h-14 rounded-2xl text-base shadow-md shadow-orange-700/20"
        disabled={busy !== null}
        onClick={() => pay("full", { mode: "full" })}
      >
        {spinner("full") ?? <Wallet className="size-5" aria-hidden />}
        {t("payRest", { amount: options.remaining })}
      </Button>
      {options.picker && (
        <ItemPicker
          {...options.picker}
          busy={busy !== null}
          payLabel={(amount) => t("payChosen", { amount })}
          onPay={(itemIds) => pay("items", { mode: "items", itemIds })}
        />
      )}
      {(options.split || options.splitChoices.length > 0) && (
        <fieldset className="flex flex-col gap-3 rounded-2xl bg-muted/50 p-4">
          <legend className="sr-only">{t("splitTitle")}</legend>
          <p aria-hidden className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-primary" />
            {t("splitTitle")}
          </p>
          {!options.split && (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("waysLabel")}>
              {options.splitChoices.map((choice) => (
                <Button
                  key={choice.count}
                  size="sm"
                  className="h-9 rounded-full px-4"
                  variant={ways === choice.count ? "default" : "outline"}
                  aria-pressed={ways === choice.count}
                  onClick={() => setWays(choice.count)}
                >
                  {t("ways", { count: choice.count })}
                </Button>
              ))}
            </div>
          )}
          {shares.length > 0 && (
            <ul className="grid grid-cols-2 gap-2" aria-label={t("sharesLabel")}>
              {shares.map((share) => (
                <li key={share.index}>
                  <Button
                    variant="outline"
                    className="h-12 w-full rounded-2xl bg-card font-semibold"
                    disabled={busy !== null}
                    onClick={() =>
                      pay(`share-${share.index}`, {
                        mode: "equal",
                        shareCount: options.split?.count ?? ways!,
                        shareIndex: share.index,
                      })
                    }
                  >
                    {spinner(`share-${share.index}`)}
                    {t("payShare", { index: share.index, amount: share.amount })}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}
    </section>
  );
}
