"use client";

import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { itemsAmount } from "@/shared/domain/bill-split";
import { formatMoney } from "@/shared/utils/money";

export interface PickerLine {
  id: string;
  name: string;
  quantity: number;
  lineTotalMinor: number;
  memberId: string | null;
}

export interface PickerProps {
  /** Lines nobody has paid or is paying yet. */
  lines: PickerLine[];
  /** Who ordered: label per member id (already "You" / "Guest 2" / a name). */
  people: { memberId: string; label: string }[];
  bill: { subtotalMinor: number; totalMinor: number; heldMinor: number; currency: string };
  /** Pre-selected lines (the guest's own). */
  initial: string[];
  payLabel: (amount: string) => string;
  onPay: (itemIds: string[]) => Promise<unknown>;
  busy: boolean;
}

/**
 * Tick the lines to pay for — your own, a friend's, any mix (§23). The
 * amount shown uses the same rule as the server, which recalculates it.
 */
export function ItemPicker({ lines, people, bill, initial, payLabel, onPay, busy }: PickerProps) {
  const t = useTranslations("Bill.pick");
  const locale = useLocale();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(initial));
  const [paying, setPaying] = useState(false);

  const linesMinor = lines
    .filter((l) => chosen.has(l.id))
    .reduce((s, l) => s + l.lineTotalMinor, 0);
  const amount = itemsAmount({
    linesMinor,
    subtotalMinor: bill.subtotalMinor,
    totalMinor: bill.totalMinor,
    heldMinor: bill.heldMinor,
    isLast: chosen.size === lines.length,
    currency: bill.currency,
  });
  const toggle = (ids: string[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const labelOf = (memberId: string | null) =>
    people.find((p) => p.memberId === memberId)?.label ?? t("unknownGuest");

  return (
    <fieldset className="flex flex-col gap-3 rounded-2xl bg-muted/50 p-4">
      <legend className="sr-only">{t("title")}</legend>
      <p aria-hidden className="text-sm font-semibold">
        {t("title")}
      </p>
      {people.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("quickLabel")}>
          {people.map((person) => {
            const theirs = lines.filter((l) => l.memberId === person.memberId).map((l) => l.id);
            if (theirs.length === 0) return null;
            const all = theirs.every((id) => chosen.has(id));
            return (
              <Button
                key={person.memberId}
                size="sm"
                className="h-8 rounded-full px-3"
                variant={all ? "default" : "outline"}
                aria-pressed={all}
                onClick={() => toggle(theirs, !all)}
              >
                {t("whose", { who: person.label })}
              </Button>
            );
          })}
        </div>
      )}
      <ul className="flex flex-col gap-1.5" aria-label={t("linesLabel")}>
        {lines.map((line) => (
          <li key={line.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-border has-checked:ring-2 has-checked:ring-primary">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-primary"
                checked={chosen.has(line.id)}
                onChange={(e) => toggle([line.id], e.target.checked)}
              />
              <span className="flex-1">
                {line.quantity} × {line.name}
                <span className="mt-0.5 block w-fit rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {labelOf(line.memberId)}
                </span>
              </span>
              <span className="font-semibold tabular-nums">
                {formatMoney(line.lineTotalMinor, bill.currency, locale)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <Button
        size="lg"
        className="h-12 rounded-2xl"
        disabled={busy || paying || chosen.size === 0 || amount <= 0}
        onClick={async () => {
          setPaying(true);
          await onPay([...chosen]);
          setPaying(false);
        }}
      >
        {paying && <Loader2 className="animate-spin" aria-hidden />}
        {payLabel(formatMoney(amount, bill.currency, locale))}
      </Button>
    </fieldset>
  );
}
