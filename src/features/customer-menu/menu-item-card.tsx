"use client";

import { Minus, Plus } from "lucide-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CustomerMenuItem } from "@/server/services/customer-menu-service";
import {
  defaultSelection,
  MAX_ITEM_QUANTITY,
  selectionProblems,
  toggleModifier,
  unitPriceMinor,
} from "@/shared/domain/item-selection";
import { formatMoney } from "@/shared/utils/money";

import { useCart } from "./cart-context";

export interface ItemChoice {
  itemId: string;
  modifierIds: string[];
  quantity: number;
  note: string;
}

const MAX_NOTE = 200;

/** A menu row; tapping it opens the item sheet with options, quantity and note. */
export function MenuItemCard({ item, currency }: { item: CustomerMenuItem; currency: string }) {
  const t = useTranslations("CustomerMenu");
  const ta = useTranslations("Allergens");
  const td = useTranslations("Dietary");
  const locale = useLocale();
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(() => defaultSelection(item.modifierGroups));
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  const problems = useMemo(
    () => selectionProblems(item.modifierGroups, selected),
    [item.modifierGroups, selected],
  );
  const total = unitPriceMinor(item.priceMinor, item.modifierGroups, selected) * quantity;
  const missing = problems.find((p) => p.problem === "tooFew");
  const price = (minor: number) => formatMoney(minor, currency, locale);

  function reset() {
    setSelected(defaultSelection(item.modifierGroups));
    setQuantity(1);
    setNote("");
  }

  function add() {
    const choice: ItemChoice = {
      itemId: item.id,
      modifierIds: selected,
      quantity,
      note: note.trim(),
    };
    cart.add(choice);
    toast.success(t("added", { name: item.name }));
    setOpen(false);
    reset();
  }

  const row = (
    <div className="flex gap-3 py-3 text-left">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h4 className="font-medium">{item.name}</h4>
        {item.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
        )}
        {(item.dietaryTags.length > 0 || item.allergens.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {item.dietaryTags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {td(tag)}
              </Badge>
            ))}
            {item.allergens.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {t("contains", { list: item.allergens.map((a) => ta(a)).join(", ") })}
              </span>
            )}
          </div>
        )}
        <div className="mt-auto flex items-center gap-2 pt-1">
          <span className="font-semibold tabular-nums">{price(item.priceMinor)}</span>
          {item.unavailable && <Badge variant="outline">{t(item.unavailable)}</Badge>}
        </div>
      </div>
      {item.imageUrl && (
        <div className="relative size-24 shrink-0 overflow-hidden rounded-xl bg-muted">
          <Image
            src={item.imageUrl}
            alt=""
            fill
            unoptimized
            sizes="96px"
            className="object-cover"
          />
        </div>
      )}
    </div>
  );

  if (item.unavailable) {
    return (
      <article aria-label={item.name} className="opacity-60">
        {row}
      </article>
    );
  }

  return (
    <article aria-label={item.name}>
      <button
        type="button"
        className="w-full rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {row}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-2xl p-0"
        >
          {item.imageUrl && (
            <div className="relative aspect-[4/3] w-full bg-muted">
              <Image
                src={item.imageUrl}
                alt=""
                fill
                unoptimized
                sizes="100vw"
                className="object-cover"
              />
            </div>
          )}
          <SheetHeader className="p-4">
            <SheetTitle className="text-xl">{item.name}</SheetTitle>
            {item.description && <SheetDescription>{item.description}</SheetDescription>}
            {item.allergens.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("contains", { list: item.allergens.map((a) => ta(a)).join(", ") })}
              </p>
            )}
          </SheetHeader>

          <div className="flex flex-col gap-5 px-4 pb-4">
            {item.modifierGroups.map((group) => {
              const single = group.maxSelect === 1;
              const rule =
                group.minSelect >= 1
                  ? single
                    ? t("rule.pickOne")
                    : t("rule.pickUpTo", { min: group.minSelect, max: group.maxSelect })
                  : t("rule.optional", { max: group.maxSelect });
              const groupMissing = problems.some(
                (p) => p.groupId === group.id && p.problem === "tooFew",
              );
              return (
                <fieldset key={group.id} className="flex flex-col gap-2">
                  <legend className="mb-2 flex w-full items-center justify-between gap-2">
                    <span className="font-medium">{group.name}</span>
                    <Badge
                      variant={
                        groupMissing ? "destructive" : group.minSelect >= 1 ? "default" : "outline"
                      }
                    >
                      {rule}
                    </Badge>
                  </legend>
                  {group.modifiers.map((modifier) => {
                    const checked = selected.includes(modifier.id);
                    return (
                      <label
                        key={modifier.id}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-lg border px-3",
                          checked && "border-primary bg-primary/5",
                          !modifier.isAvailable && "opacity-50",
                        )}
                      >
                        <input
                          type={single ? "radio" : "checkbox"}
                          name={`group-${group.id}`}
                          className="size-4 accent-primary"
                          checked={checked}
                          disabled={!modifier.isAvailable}
                          onChange={() =>
                            setSelected(toggleModifier(item.modifierGroups, selected, modifier.id))
                          }
                        />
                        <span className="flex-1">{modifier.name}</span>
                        <span className="text-sm text-muted-foreground tabular-nums">
                          {!modifier.isAvailable
                            ? t("outOfStock")
                            : modifier.priceDeltaMinor > 0
                              ? `+${price(modifier.priceDeltaMinor)}`
                              : ""}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              );
            })}

            <label className="flex flex-col gap-1 text-sm">
              {t("note")}
              <Textarea
                rows={2}
                maxLength={MAX_NOTE}
                placeholder={t("notePlaceholder")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>

          <SheetFooter className="sticky bottom-0 flex-row items-center gap-3 border-t bg-background p-4">
            <div className="flex items-center gap-1" role="group" aria-label={t("quantity")}>
              <Button
                size="icon"
                variant="outline"
                aria-label={t("decrease")}
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                <Minus aria-hidden />
              </Button>
              <output className="w-8 text-center font-medium tabular-nums" aria-live="polite">
                {quantity}
              </output>
              <Button
                size="icon"
                variant="outline"
                aria-label={t("increase")}
                disabled={quantity >= MAX_ITEM_QUANTITY}
                onClick={() => setQuantity((q) => Math.min(MAX_ITEM_QUANTITY, q + 1))}
              >
                <Plus aria-hidden />
              </Button>
            </div>
            <Button className="h-11 flex-1" disabled={problems.length > 0} onClick={add}>
              {missing ? t("chooseRequired") : t("add", { price: price(total) })}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </article>
  );
}
