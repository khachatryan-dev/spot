"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useOptimisticValue } from "@/components/shared/use-optimistic-value";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { setItemStockAction, setModifierStockAction } from "./stock-actions";
import { useRun } from "./use-run";

export interface StockCategory {
  id: string;
  name: string;
  items: {
    id: string;
    name: string;
    isAvailable: boolean;
    modifiers: { id: string; name: string; isAvailable: boolean }[];
  }[];
}

/** One-tap stock switches for service. Large touch targets; filter by name. */
export function StockList({
  restaurantId,
  categories,
}: {
  restaurantId: string;
  categories: StockCategory[];
}) {
  const t = useTranslations("Stock");
  const [query, setQuery] = useState("");
  const q = query.trim().toLocaleLowerCase();
  const visible = categories
    .map((c) => ({
      ...c,
      items: c.items.filter((i) => !q || i.name.toLocaleLowerCase().includes(q)),
    }))
    .filter((c) => c.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        aria-label={t("search")}
        placeholder={t("search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {visible.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      {visible.map((category) => (
        <section key={category.id} aria-label={category.name} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{category.name}</h2>
          <ul className="flex flex-col divide-y rounded-xl border">
            {category.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 p-3">
                <StockSwitch
                  label={item.name}
                  available={item.isAvailable}
                  save={(value) => setItemStockAction(restaurantId, item.id, value)}
                  strong
                />
                {item.modifiers.length > 0 && (
                  <div className="flex flex-wrap gap-2 pl-2">
                    {item.modifiers.map((modifier) => (
                      <StockSwitch
                        key={modifier.id}
                        label={modifier.name}
                        context={item.name}
                        available={modifier.isAvailable}
                        save={(value) => setModifierStockAction(restaurantId, modifier.id, value)}
                      />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StockSwitch({
  label,
  context,
  available,
  save,
  strong,
}: {
  label: string;
  /** Parent item, for an unambiguous accessible name ("Large — Margherita"). */
  context?: string;
  available: boolean;
  save: (value: boolean) => ReturnType<typeof setItemStockAction>;
  strong?: boolean;
}) {
  const t = useTranslations("Stock");
  const { busy, run } = useRun();
  const [value, setValue, reset] = useOptimisticValue(available);
  const name = context ? `${label} — ${context}` : label;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={t("toggle", { name })}
      disabled={busy !== null}
      onClick={async () => {
        const next = !value;
        setValue(next);
        if (!(await run("stock", () => save(next)))) reset();
      }}
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        strong ? "w-full" : "text-sm",
        value ? "bg-background" : "border-destructive/40 bg-destructive/5",
      )}
    >
      <span className={cn(strong && "font-medium", !value && "text-muted-foreground line-through")}>
        {label}
      </span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs font-medium",
          value ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
        )}
      >
        {value ? t("inStock") : t("outOfStock")}
      </span>
    </button>
  );
}
