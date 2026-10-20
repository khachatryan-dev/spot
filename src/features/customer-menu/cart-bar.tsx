"use client";

import { Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useApiError } from "@/components/shared/use-api-error";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MAX_ITEM_QUANTITY } from "@/shared/domain/item-selection";
import { placeOrderAction } from "@/features/ordering/actions";
import { useRouter } from "@/i18n/navigation";
import { formatMoney } from "@/shared/utils/money";

import { useCart, useHydrated } from "./cart-context";

/** Sticky "View order" bar and the cart sheet. */
export function CartBar() {
  const t = useTranslations("Cart");
  const locale = useLocale();
  const hydrated = useHydrated();
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const apiError = useApiError();
  const [placing, setPlacing] = useState(false);
  const signature = cart.lines.map((l) => `${l.lineId}:${l.quantity}`).join();
  /** Server problems per cart line from the last attempt — only while the cart is unchanged. */
  const [attempt, setAttempt] = useState<{ signature: string; errors: Record<string, string> }>({
    signature: "",
    errors: {},
  });
  const lineErrors = attempt.signature === signature ? attempt.errors : {};
  /** One key per checkout: retries reuse it (no double orders); a changed cart gets a new one. */
  const checkoutKey = useRef<{ signature: string; key: string } | null>(null);

  /** Set synchronously: a second tap can land before React re-renders the disabled button. */
  const inFlight = useRef(false);

  async function placeOrder() {
    if (inFlight.current) return;
    inFlight.current = true;
    const lines = cart.lines.filter((l) => l.available);
    if (checkoutKey.current?.signature !== signature) {
      checkoutKey.current = { signature, key: crypto.randomUUID() };
    }
    setPlacing(true);
    const result = await placeOrderAction({
      lines: lines.map(({ itemId, modifierIds, quantity, note }) => ({
        itemId,
        modifierIds,
        quantity,
        note,
      })),
      idempotencyKey: checkoutKey.current.key,
    });
    setPlacing(false);
    inFlight.current = false;
    if (result.error) {
      const errors: Record<string, string> = {};
      for (const [field, [reason]] of Object.entries(result.error.fieldErrors ?? {})) {
        const index = Number(field.split(".")[1]);
        const line = lines[index];
        if (line && reason) errors[line.lineId] = reason;
      }
      setAttempt({ signature, errors });
      toast.error(
        Object.keys(errors).length > 0 ? t("someUnavailable") : apiError.message(result.error),
      );
      router.refresh(); // pick up the latest stock and prices
      return;
    }
    cart.clear();
    setOpen(false);
    router.push(`/table/orders?placed=${result.data.id}`);
  }
  const price = (minor: number) => formatMoney(minor, cart.currency, locale);

  if (!hydrated || cart.lines.length === 0) return null;

  return (
    <>
      {/* Spacer so the bar never covers the last menu item. */}
      <div className="h-20" aria-hidden />
      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md p-3">
        <Button
          className="h-14 w-full justify-between rounded-2xl bg-gradient-to-r from-orange-700 to-rose-600 px-4 text-base shadow-xl shadow-orange-700/30 hover:from-orange-800 hover:to-rose-700 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4"
          onClick={() => setOpen(true)}
        >
          <span className="flex items-center gap-2">
            <ShoppingBag aria-hidden />
            {t("view")}
            {/* Re-keyed so the count pops each time something is added. */}
            <span
              key={cart.itemCount}
              className="grid min-w-6 place-items-center rounded-full bg-white px-1.5 text-sm font-bold text-orange-800 motion-safe:animate-in motion-safe:zoom-in-50 dark:bg-card dark:text-orange-300"
            >
              {cart.itemCount}
            </span>
          </span>
          <span className="tabular-nums">{price(cart.subtotalMinor)}</span>
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-2xl p-0"
        >
          <SheetHeader className="p-4">
            <SheetTitle>{t("title")}</SheetTitle>
          </SheetHeader>
          <ul className="flex flex-col divide-y px-4" aria-label={t("title")}>
            {cart.lines.map((line) => (
              <li
                key={line.lineId}
                className={`flex flex-col gap-2 py-3 ${line.available ? "" : "opacity-60"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{line.name || t("removedItem")}</span>
                    {line.modifierNames.length > 0 && (
                      <span className="text-sm text-muted-foreground">
                        {line.modifierNames.join(", ")}
                      </span>
                    )}
                    {line.note && (
                      <span className="text-sm text-muted-foreground italic">“{line.note}”</span>
                    )}
                    {!line.available && (
                      <span className="text-sm text-destructive">{t("unavailable")}</span>
                    )}
                    {line.available && lineErrors[line.lineId] && (
                      <span role="alert" className="text-sm text-destructive">
                        {t(
                          `lineErrors.${lineErrors[line.lineId] as "outOfStock" | "itemUnavailable" | "optionsInvalid"}`,
                        )}
                      </span>
                    )}
                  </div>
                  <span className="font-medium tabular-nums">
                    {line.available ? price(line.totalMinor) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  {line.available ? (
                    <div
                      className="flex items-center gap-1"
                      role="group"
                      aria-label={t("quantityFor", { name: line.name })}
                    >
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={t("decrease", { name: line.name })}
                        onClick={() => cart.setQuantity(line.lineId, line.quantity - 1)}
                      >
                        <Minus aria-hidden />
                      </Button>
                      <output className="w-8 text-center tabular-nums">{line.quantity}</output>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={t("increase", { name: line.name })}
                        disabled={line.quantity >= MAX_ITEM_QUANTITY}
                        onClick={() => cart.setQuantity(line.lineId, line.quantity + 1)}
                      >
                        <Plus aria-hidden />
                      </Button>
                    </div>
                  ) : (
                    <span />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("remove", { name: line.name })}
                    onClick={() => cart.remove(line.lineId)}
                  >
                    <Trash2 aria-hidden />
                    {t("removeShort")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <SheetFooter className="sticky bottom-0 gap-2 border-t bg-background p-4">
            <div className="flex items-center justify-between text-base font-semibold">
              <span>{t("subtotal")}</span>
              <span className="tabular-nums">{price(cart.subtotalMinor)}</span>
            </div>
            {cart.hasUnavailable && (
              <p className="text-sm text-destructive">{t("removeUnavailable")}</p>
            )}
            <Button
              className="h-11"
              disabled={placing || cart.hasUnavailable || cart.itemCount === 0}
              onClick={placeOrder}
            >
              {placing && <Loader2 className="animate-spin" aria-hidden />}
              {t("placeOrder")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
