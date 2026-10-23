import { getTranslations } from "next-intl/server";

import { ReceiptText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Bill, BillItem } from "@/server/db/schema";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/shared/utils/money";

/** A bill's lines and totals (§22), the same for staff and guests. */
export async function BillDetails({
  bill,
  lines,
  locale,
  coveredItemIds = [],
}: {
  bill: Bill;
  lines: BillItem[];
  locale: string;
  /** Lines already paid or being paid (split by items). */
  coveredItemIds?: string[];
}) {
  const t = await getTranslations("Bill");
  const money = (minor: number) => formatMoney(minor, bill.currency, locale);
  const left = bill.totalMinor - bill.paidMinor;
  const row = (label: string, amount: string, strong = false) => (
    <div className={cn("flex justify-between gap-3", strong && "text-lg font-bold")}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{amount}</dd>
    </div>
  );

  return (
    <section
      aria-label={t("title")}
      className="flex flex-col gap-3 rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <ReceiptText className="size-5 text-muted-foreground" aria-hidden />
          {t("title")}
        </h2>
        <Badge
          variant="outline"
          className={cn(
            bill.status === "paid" &&
              "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
            bill.status === "finalized" &&
              "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300",
          )}
        >
          {t(`status.${bill.status}`)}
        </Badge>
      </div>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2.5 text-sm" aria-label={t("lines")}>
          {lines.map((line) => (
            <li
              key={line.id}
              className={cn(
                "flex justify-between gap-3",
                coveredItemIds.includes(line.id) && "text-muted-foreground",
              )}
            >
              <span>
                {line.quantity} × {line.name}
                {coveredItemIds.includes(line.id) && (
                  <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    {t("covered")}
                  </span>
                )}
                {line.options.length > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    {line.options.map((o) => o.name).join(", ")}
                  </span>
                )}
              </span>
              <span className="tabular-nums">{money(line.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
      )}
      {/* Receipt-style tear line */}
      <dl className="flex flex-col gap-1.5 border-t-2 border-dashed pt-3 text-sm">
        {row(t("subtotal"), money(bill.subtotalMinor))}
        {bill.discountMinor > 0 && row(t("discount"), `−${money(bill.discountMinor)}`)}
        {bill.serviceFeeMinor > 0 &&
          row(t("serviceFee", { percent: bill.serviceFeeBps / 100 }), money(bill.serviceFeeMinor))}
        {row(t("total"), money(bill.totalMinor), true)}
        {bill.vatRateBps > 0 && (
          <div className="flex justify-between gap-3 text-xs text-muted-foreground">
            <dt>{t("vatIncluded", { percent: bill.vatRateBps / 100 })}</dt>
            <dd className="tabular-nums">{money(bill.taxIncludedMinor)}</dd>
          </div>
        )}
        {bill.paidMinor > 0 && row(t("paid"), money(bill.paidMinor))}
        {bill.status === "finalized" && bill.paidMinor > 0 && row(t("left"), money(left), true)}
      </dl>
    </section>
  );
}
