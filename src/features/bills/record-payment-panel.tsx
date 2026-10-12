"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useRun } from "@/features/menu-editor/use-run";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { recordBillPaymentAction } from "./actions";
import { ItemPicker, type PickerProps } from "./item-picker";

/** Staff take cash or card-terminal payments: the rest, or a free equal share. */
export function RecordPaymentPanel({
  restaurantId,
  billId,
  remaining,
  freeShares,
  shareCount,
  picker,
}: {
  restaurantId: string;
  billId: string;
  remaining: string;
  freeShares: { index: number; amount: string }[];
  shareCount: number | null;
  /** Record a payment for chosen lines (null while split equally). */
  picker: Omit<PickerProps, "onPay" | "busy" | "payLabel"> | null;
}) {
  const t = useTranslations("Bill.record");
  const { busy, run } = useRun();
  const [method, setMethod] = useState<"cash" | "card_terminal">("cash");
  const spinner = (key: string) =>
    busy === key ? <Loader2 className="animate-spin" aria-hidden /> : null;

  return (
    <section
      aria-labelledby="record-heading"
      className="flex flex-col gap-3 rounded-2xl border p-4"
    >
      <h3 id="record-heading" className="font-semibold">
        {t("title")}
      </h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="method">{t("method")}</Label>
        <select
          id="method"
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
          className="h-8 w-48 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        >
          <option value="cash">{t("cash")}</option>
          <option value="card_terminal">{t("card_terminal")}</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy !== null}
          onClick={() =>
            run(
              "full",
              () => recordBillPaymentAction(restaurantId, billId, { mode: "full", method }),
              t("recorded"),
            )
          }
        >
          {spinner("full")}
          {t("rest", { amount: remaining })}
        </Button>
        {shareCount &&
          freeShares.map((share) => (
            <Button
              key={share.index}
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                run(
                  `share-${share.index}`,
                  () =>
                    recordBillPaymentAction(restaurantId, billId, {
                      mode: "equal",
                      shareCount,
                      shareIndex: share.index,
                      method,
                    }),
                  t("recorded"),
                )
              }
            >
              {spinner(`share-${share.index}`)}
              {t("share", { index: share.index, amount: share.amount })}
            </Button>
          ))}
      </div>
      {picker && (
        <ItemPicker
          {...picker}
          busy={busy !== null}
          payLabel={(amount) => t("chosen", { amount })}
          onPay={(itemIds) =>
            run(
              "items",
              () =>
                recordBillPaymentAction(restaurantId, billId, { mode: "items", itemIds, method }),
              t("recorded"),
            )
          }
        />
      )}
    </section>
  );
}
