"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OpeningHoursEditor } from "@/features/restaurant-locations/opening-hours-editor";
import type { OpeningHours } from "@/shared/schemas/opening-hours";

import { updateMenuAction } from "./actions";
import { useRun } from "./use-run";

interface Props {
  restaurantId: string;
  menu: {
    id: string;
    name: string;
    isActive: boolean;
    locationIds: string[];
    availableHours: Partial<OpeningHours> | null;
  };
  locations: { id: string; name: string }[];
  readOnly: boolean;
}

export function MenuSettings({ restaurantId, menu, locations, readOnly }: Props) {
  const t = useTranslations("Menu");
  const { busy, run } = useRun();
  const [name, setName] = useState(menu.name);
  const [isActive, setIsActive] = useState(menu.isActive);
  const [locationIds, setLocationIds] = useState(menu.locationIds);
  const [hours, setHours] = useState<Partial<OpeningHours> | null>(menu.availableHours);

  const dirty =
    name !== menu.name ||
    isActive !== menu.isActive ||
    [...locationIds].sort().join() !== [...menu.locationIds].sort().join() ||
    JSON.stringify(hours) !== JSON.stringify(menu.availableHours);

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          "settings",
          () =>
            updateMenuAction(restaurantId, menu.id, {
              name,
              isActive,
              locationIds,
              availableHours: hours as OpeningHours | null,
            }),
          t("saved"),
        );
      }}
    >
      <fieldset disabled={readOnly || busy !== null} className="flex min-w-0 flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="menu-name">{t("menuName")}</FieldLabel>
          <Input
            id="menu-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
          />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">{t("servedAt")}</FieldLegend>
          {locations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noLocations")}</p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {locations.map((location) => (
                <label key={location.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={locationIds.includes(location.id)}
                    onChange={(e) =>
                      setLocationIds(
                        e.target.checked
                          ? [...locationIds, location.id]
                          : locationIds.filter((id) => id !== location.id),
                      )
                    }
                  />
                  {location.name}
                </label>
              ))}
            </div>
          )}
        </FieldSet>
        <FieldSet>
          <FieldLegend variant="label">{t("hoursTitle")}</FieldLegend>
          <div
            role="radiogroup"
            aria-label={t("hoursTitle")}
            className="flex flex-col gap-2 text-sm"
          >
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="menu-hours"
                className="size-4 accent-primary"
                checked={hours === null}
                onChange={() => setHours(null)}
              />
              {t("hoursAlways")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="menu-hours"
                className="size-4 accent-primary"
                checked={hours !== null}
                onChange={() =>
                  setHours({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] })
                }
              />
              {t("hoursLimited")}
            </label>
          </div>
          {hours !== null && (
            <OpeningHoursEditor
              emptyNote={t("hoursEmpty")}
              value={hours}
              onChange={setHours}
              disabled={readOnly || busy !== null}
            />
          )}
        </FieldSet>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          {t("menuActive")}
        </label>
        {!readOnly && (
          <Button
            type="submit"
            variant="outline"
            className="self-start"
            disabled={!dirty || name.trim() === ""}
          >
            {t("saveSettings")}
          </Button>
        )}
      </fieldset>
    </form>
  );
}
