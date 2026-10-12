"use client";

import { AlertTriangle, ArrowDown, ArrowUp, Plus, Star, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useOptimisticValue } from "@/components/shared/use-optimistic-value";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, toMinorUnits } from "@/shared/utils/money";

import {
  createModifierAction,
  createModifierGroupAction,
  deleteModifierAction,
  deleteModifierGroupAction,
  reorderModifierGroupsAction,
  reorderModifiersAction,
  setModifierAvailabilityAction,
  updateModifierAction,
  updateModifierGroupAction,
} from "./modifier-actions";
import { useRun } from "./use-run";

export interface ModifierGroupData {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: {
    id: string;
    name: string;
    priceDeltaMinor: number;
    isDefault: boolean;
    isAvailable: boolean;
  }[];
}

const moved = (ids: string[], index: number, by: -1 | 1) => {
  const next = [...ids];
  const [id] = next.splice(index, 1);
  next.splice(index + by, 0, id!);
  return next;
};

/** Options for one item: groups like "Size" (pick 1) or "Extras" (up to 3), each with modifiers. */
export function ModifierGroupsEditor({
  restaurantId,
  itemId,
  currency,
  groups,
  readOnly,
}: {
  restaurantId: string;
  itemId: string;
  currency: string;
  groups: ModifierGroupData[];
  readOnly: boolean;
}) {
  const t = useTranslations("Menu.modifiers");
  const { busy, run } = useRun();
  const [name, setName] = useState("");
  const [required, setRequired] = useState(true);
  const [max, setMax] = useState("1");

  async function addGroup(event: React.FormEvent) {
    event.preventDefault();
    const maxSelect = Number(max);
    const done = await run("new-group", () =>
      createModifierGroupAction(restaurantId, itemId, {
        name,
        minSelect: required ? 1 : 0,
        maxSelect,
      }),
    );
    if (done) {
      setName("");
      setRequired(true);
      setMax("1");
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="options-title">
      <div className="flex flex-col gap-1">
        <h2 id="options-title" className="text-lg font-medium">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      {groups.map((group, index) => (
        <GroupCard
          key={group.id}
          restaurantId={restaurantId}
          currency={currency}
          group={group}
          readOnly={readOnly}
          busy={busy !== null}
          run={run}
          onMove={
            readOnly
              ? undefined
              : (by) =>
                  run(`move-${group.id}`, () =>
                    reorderModifierGroupsAction(
                      restaurantId,
                      itemId,
                      moved(
                        groups.map((g) => g.id),
                        index,
                        by,
                      ),
                    ),
                  )
          }
          isFirst={index === 0}
          isLast={index === groups.length - 1}
        />
      ))}
      {!readOnly && (
        <form
          onSubmit={addGroup}
          className="flex flex-col gap-3 rounded-xl border border-dashed p-4 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <label className="flex flex-1 flex-col gap-1 text-sm">
            {t("groupName")}
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("groupPlaceholder")}
              maxLength={120}
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:pb-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            {t("required")}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("maxChoices")}
            <Input
              type="number"
              min={1}
              max={20}
              className="w-24"
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </label>
          <Button
            type="submit"
            variant="outline"
            disabled={busy !== null || name.trim() === "" || !(Number(max) >= 1)}
          >
            <Plus aria-hidden />
            {t("addGroup")}
          </Button>
        </form>
      )}
    </section>
  );
}

function GroupCard({
  restaurantId,
  currency,
  group,
  readOnly,
  busy,
  run,
  onMove,
  isFirst,
  isLast,
}: {
  restaurantId: string;
  currency: string;
  group: ModifierGroupData;
  readOnly: boolean;
  busy: boolean;
  run: ReturnType<typeof useRun>["run"];
  onMove?: (by: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const t = useTranslations("Menu.modifiers");
  const locale = useLocale();
  const [modName, setModName] = useState("");
  const [modPrice, setModPrice] = useState("");
  const [minSelect, setMinSelect, resetMin] = useOptimisticValue(group.minSelect);
  const [maxSelect, setMaxSelect, resetMax] = useOptimisticValue(group.maxSelect);
  const required = minSelect >= 1;
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const unorderable = required && !group.modifiers.some((m) => availability[m.id] ?? m.isAvailable);

  async function addModifier(event: React.FormEvent) {
    event.preventDefault();
    const priceDeltaMinor = modPrice.trim() === "" ? 0 : toMinorUnits(modPrice, currency);
    if (priceDeltaMinor === null) return void toast.error(t("priceInvalid"));
    const done = await run(`add-${group.id}`, () =>
      createModifierAction(restaurantId, group.id, { name: modName, priceDeltaMinor }),
    );
    if (done) {
      setModName("");
      setModPrice("");
    }
  }

  const rule = required
    ? maxSelect === 1
      ? t("rulePickOne")
      : t("ruleRequiredUpTo", { max: maxSelect })
    : t("ruleOptionalUpTo", { max: maxSelect });

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4" role="group" aria-label={group.name}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 font-medium">{group.name}</h3>
        <Badge variant={required ? "default" : "outline"}>{rule}</Badge>
        {!readOnly && (
          <div className="flex">
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("moveGroupUp", { name: group.name })}
              disabled={busy || isFirst}
              onClick={() => onMove?.(-1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("moveGroupDown", { name: group.name })}
              disabled={busy || isLast}
              onClick={() => onMove?.(1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("deleteGroup", { name: group.name })}
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("deleteGroupConfirm", { name: group.name }))) {
                  void run(group.id, () => deleteModifierGroupAction(restaurantId, group.id));
                }
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={required}
              disabled={busy}
              onChange={async (e) => {
                const next = e.target.checked ? 1 : 0;
                setMinSelect(next);
                const done = await run(group.id, () =>
                  updateModifierGroupAction(restaurantId, group.id, { minSelect: next }),
                );
                if (!done) resetMin();
              }}
            />
            {t("required")}
          </label>
          <label className="flex items-center gap-2">
            {t("maxChoices")}
            <select
              aria-label={t("maxFor", { name: group.name })}
              className="h-8 rounded-lg border bg-transparent px-2"
              value={maxSelect}
              disabled={busy}
              onChange={async (e) => {
                const next = Number(e.target.value);
                setMaxSelect(next);
                const done = await run(group.id, () =>
                  updateModifierGroupAction(restaurantId, group.id, { maxSelect: next }),
                );
                if (!done) resetMax();
              }}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1)
                .filter((n) => n >= minSelect)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}

      {unorderable && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="size-4" aria-hidden />
          {t("noneAvailable")}
        </p>
      )}

      {group.modifiers.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {group.modifiers.map((modifier, index) => (
            <li key={modifier.id} className="flex flex-wrap items-center gap-2 p-2">
              <span
                className={
                  modifier.isAvailable ? "flex-1" : "flex-1 text-muted-foreground line-through"
                }
              >
                {modifier.name}
              </span>
              {modifier.isDefault && (
                <Badge variant="secondary">
                  <Star aria-hidden />
                  {t("default")}
                </Badge>
              )}
              <span className="text-sm tabular-nums">
                {modifier.priceDeltaMinor > 0
                  ? `+${formatMoney(modifier.priceDeltaMinor, currency, locale)}`
                  : t("free")}
              </span>
              {!readOnly && (
                <div className="flex items-center">
                  <AvailabilityToggle
                    restaurantId={restaurantId}
                    modifier={modifier}
                    disabled={busy}
                    run={run}
                    onChange={(id, value) =>
                      setAvailability((current) => ({ ...current, [id]: value }))
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={
                      modifier.isDefault
                        ? t("unsetDefault", { name: modifier.name })
                        : t("setDefault", { name: modifier.name })
                    }
                    aria-pressed={modifier.isDefault}
                    disabled={busy}
                    onClick={() =>
                      run(modifier.id, () =>
                        updateModifierAction(restaurantId, modifier.id, {
                          isDefault: !modifier.isDefault,
                        }),
                      )
                    }
                  >
                    <Star aria-hidden className={modifier.isDefault ? "fill-current" : undefined} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("moveUp", { name: modifier.name })}
                    disabled={busy || index === 0}
                    onClick={() =>
                      run(`m-${modifier.id}`, () =>
                        reorderModifiersAction(
                          restaurantId,
                          group.id,
                          moved(
                            group.modifiers.map((m) => m.id),
                            index,
                            -1,
                          ),
                        ),
                      )
                    }
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("moveDown", { name: modifier.name })}
                    disabled={busy || index === group.modifiers.length - 1}
                    onClick={() =>
                      run(`m-${modifier.id}`, () =>
                        reorderModifiersAction(
                          restaurantId,
                          group.id,
                          moved(
                            group.modifiers.map((m) => m.id),
                            index,
                            1,
                          ),
                        ),
                      )
                    }
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("delete", { name: modifier.name })}
                    disabled={busy}
                    onClick={() =>
                      run(modifier.id, () => deleteModifierAction(restaurantId, modifier.id))
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <form onSubmit={addModifier} className="flex flex-wrap gap-2">
          <Input
            className="min-w-40 flex-1"
            aria-label={t("optionNameFor", { group: group.name })}
            placeholder={t("optionPlaceholder")}
            value={modName}
            onChange={(e) => setModName(e.target.value)}
            maxLength={120}
          />
          <Input
            className="w-28"
            inputMode="decimal"
            aria-label={t("optionPriceFor", { group: group.name, currency })}
            placeholder={t("pricePlaceholder")}
            value={modPrice}
            onChange={(e) => setModPrice(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={busy || modName.trim() === ""}>
            <Plus aria-hidden />
            {t("addOption")}
          </Button>
        </form>
      )}
    </div>
  );
}

function AvailabilityToggle({
  restaurantId,
  modifier,
  disabled,
  run,
  onChange,
}: {
  restaurantId: string;
  modifier: ModifierGroupData["modifiers"][number];
  disabled: boolean;
  run: ReturnType<typeof useRun>["run"];
  onChange: (id: string, value: boolean) => void;
}) {
  const t = useTranslations("Menu.modifiers");
  const [isAvailable, setIsAvailable, reset] = useOptimisticValue(modifier.isAvailable);
  return (
    <label className="mr-1 flex items-center gap-1 text-xs">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        aria-label={t("availableFor", { name: modifier.name })}
        checked={isAvailable}
        disabled={disabled}
        onChange={async (e) => {
          const next = e.target.checked;
          setIsAvailable(next);
          onChange(modifier.id, next);
          const done = await run(modifier.id, () =>
            setModifierAvailabilityAction(restaurantId, modifier.id, next),
          );
          if (!done) {
            reset();
            onChange(modifier.id, modifier.isAvailable);
          }
        }}
      />
      {t("available")}
    </label>
  );
}
