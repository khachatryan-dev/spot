"use client";

import { Copy, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type OpeningPeriod, WEEKDAYS, type Weekday } from "@/shared/schemas/opening-hours";

type Value = Partial<Record<Weekday, OpeningPeriod[]>>;

const DEFAULT_PERIOD: OpeningPeriod = { open: "09:00", close: "22:00" };
const MAX_PERIODS = 3;

/** Weekly schedule: each day closed or up to 3 periods; close < open means past midnight. */
export function OpeningHoursEditor({
  value,
  onChange,
  disabled,
  emptyNote,
}: {
  value: Value;
  onChange: (value: Value) => void;
  disabled?: boolean;
  /** Shown while no day has hours — what that means differs per place it's used. */
  emptyNote?: string;
}) {
  const t = useTranslations("Locations.hours");
  const td = useTranslations("Weekdays");

  const setDay = (day: Weekday, periods: OpeningPeriod[]) => onChange({ ...value, [day]: periods });
  const setPeriod = (day: Weekday, index: number, patch: Partial<OpeningPeriod>) =>
    setDay(
      day,
      (value[day] ?? []).map((p, i) => (i === index ? { ...p, ...patch } : p)),
    );

  const noneSet = WEEKDAYS.every((day) => (value[day] ?? []).length === 0);
  return (
    <div className="flex flex-col gap-3">
      {noneSet && emptyNote && (
        <p role="note" className="rounded-lg border bg-muted/40 p-3 text-sm">
          {emptyNote}
        </p>
      )}
      <ul className="flex flex-col divide-y rounded-xl border">
        {WEEKDAYS.map((day) => {
          const periods = value[day] ?? [];
          const open = periods.length > 0;
          return (
            <li key={day} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
              <label className="flex w-40 shrink-0 items-center gap-2 pt-1.5 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={open}
                  disabled={disabled}
                  onChange={(e) => setDay(day, e.target.checked ? [DEFAULT_PERIOD] : [])}
                />
                {td(day)}
              </label>
              {open ? (
                <div className="flex flex-1 flex-col gap-2">
                  {periods.map((period, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        type="time"
                        className="w-28"
                        aria-label={t("opens", { day: td(day) })}
                        value={period.open}
                        disabled={disabled}
                        onChange={(e) => setPeriod(day, index, { open: e.target.value })}
                      />
                      <span aria-hidden>–</span>
                      <Input
                        type="time"
                        className="w-28"
                        aria-label={t("closes", { day: td(day) })}
                        value={period.close}
                        disabled={disabled}
                        onChange={(e) => setPeriod(day, index, { close: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("removePeriod")}
                        disabled={disabled}
                        onClick={() =>
                          setDay(
                            day,
                            periods.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <X aria-hidden />
                      </Button>
                    </div>
                  ))}
                  {periods.length < MAX_PERIODS && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      disabled={disabled}
                      onClick={() => setDay(day, [...periods, { open: "18:00", close: "23:00" }])}
                    >
                      <Plus aria-hidden />
                      {t("addPeriod")}
                    </Button>
                  )}
                </div>
              ) : (
                <span className="pt-1.5 text-sm text-muted-foreground">{t("closed")}</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("overnightHint")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onChange(Object.fromEntries(WEEKDAYS.map((d) => [d, [...(value.mon ?? [])]])))
          }
        >
          <Copy aria-hidden />
          {t("copyMonday")}
        </Button>
      </div>
    </div>
  );
}
