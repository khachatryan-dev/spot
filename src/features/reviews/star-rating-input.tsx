"use client";

import { Star } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/** 1–5 stars as a radio group (keyboard: arrows move, like any radio group). */
export function StarRatingInput({
  name,
  value,
  onChange,
  invalid,
}: {
  name: string;
  value: number | undefined;
  onChange: (rating: number) => void;
  invalid?: boolean;
}) {
  const t = useTranslations("Reviews");
  return (
    <fieldset aria-invalid={invalid} className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">{t("ratingLabel")}</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className="cursor-pointer rounded-md p-1 focus-within:ring-2 focus-within:ring-ring"
          >
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="sr-only"
            />
            <span className="sr-only">{t("stars", { count: n })}</span>
            <Star
              aria-hidden
              className={cn(
                "size-8 transition-colors",
                value !== undefined && n <= value
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/50",
              )}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
