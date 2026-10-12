"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Controller, type FieldErrors, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { MapView, type MapPin } from "@/components/shared/map-view";
import { useApiError } from "@/components/shared/use-api-error";
import { useFieldError } from "@/components/shared/use-field-error";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import {
  RESERVATION_CONFIRMATION_MODES,
  RESERVATION_DEPOSIT_TYPES,
} from "@/shared/constants/reservations";
import { toMajorUnits, toMinorUnits } from "@/shared/utils/money";
import { updateLocationSchema } from "@/shared/schemas/location";

import { updateLocationAction } from "./actions";
import { OpeningHoursEditor } from "./opening-hours-editor";

type FormValues = z.input<typeof updateLocationSchema>;
type TextField =
  "name" | "addressLine" | "city" | "postalCode" | "phone" | "latitude" | "longitude";
type SelectField =
  | "reservationConfirmation"
  | "reservationDurationMinutes"
  | "reservationMinNoticeMinutes"
  | "reservationMaxDaysAhead"
  | "reservationDepositType"
  | "reservationRefundCutoffHours"
  | "serviceFeeBps";

/** Choices offered for reservation settings (the server accepts any value in range). */
const DURATIONS = [60, 90, 120, 150, 180, 240];
const NOTICES = [0, 30, 60, 120, 180, 360, 720, 1440];
const DAYS_AHEAD = [7, 14, 30, 60, 90];
const CUTOFF_HOURS = [0, 2, 6, 12, 24, 48, 72];
const SERVICE_FEES = [0, 500, 1000, 1200, 1500, 2000];

/** The pin for the coordinates typed so far, if they're a valid point. */
function pinOf(latitude: unknown, longitude: unknown, label: string): MapPin[] {
  const lat = Number(String(latitude ?? "").replace(",", "."));
  const lng = Number(String(longitude ?? "").replace(",", "."));
  if (!latitude || !longitude || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
  return [{ lat, lng, label }];
}

/** Keep a saved value that isn't one of the standard choices selectable. */
const withCurrent = (choices: number[], current: unknown) =>
  typeof current === "number" && !choices.includes(current)
    ? [...choices, current].sort((a, b) => a - b)
    : choices;

/** First error message anywhere inside a nested error object (e.g. one opening period). */
function firstMessage(errors: unknown): string | undefined {
  if (!errors || typeof errors !== "object") return undefined;
  if ("message" in errors && typeof errors.message === "string") return errors.message;
  for (const value of Object.values(errors)) {
    const message = firstMessage(value);
    if (message) return message;
  }
  return undefined;
}

export function LocationForm({
  restaurantId,
  locationId,
  defaultValues,
  readOnly,
  currency,
  paymentsEnabled,
}: {
  restaurantId: string;
  locationId: string;
  defaultValues: FormValues;
  readOnly: boolean;
  /** Restaurant currency, for the deposit amount. */
  currency: string;
  /** Online payments exist here, so deposits can be switched on. */
  paymentsEnabled: boolean;
}) {
  const t = useTranslations("Locations.form");
  const fieldError = useFieldError();
  const apiError = useApiError();
  const router = useRouter();

  const form = useForm<FormValues>({ resolver: zodResolver(updateLocationSchema), defaultValues });
  const { errors, isSubmitting, isDirty } = form.formState;

  async function onSubmit(values: FormValues) {
    const result = await updateLocationAction(restaurantId, locationId, values);
    if (result.error) {
      apiError.applyFieldErrors(result.error, form.setError);
      toast.error(apiError.message(result.error));
      return;
    }
    form.reset(values);
    toast.success(t("saved"));
    router.refresh();
  }

  const text = (name: TextField, props: React.ComponentProps<typeof Input> = {}) => (
    <Field data-invalid={!!errors[name]}>
      <FieldLabel htmlFor={name}>{t(name)}</FieldLabel>
      <Input id={name} aria-invalid={!!errors[name]} {...props} {...form.register(name)} />
      <FieldError>{fieldError(errors[name]?.message)}</FieldError>
    </Field>
  );

  const depositType = form.watch("reservationDepositType");
  const latitude = form.watch("latitude");
  const longitude = form.watch("longitude");
  // Only a new point redraws (and recentres) the map — not every keystroke elsewhere.
  const pin = useMemo(
    () => pinOf(latitude, longitude, defaultValues.name ?? ""),
    [latitude, longitude, defaultValues.name],
  );
  const select = (
    name: SelectField,
    options: [value: string, label: string][],
    disabled = false,
  ) => (
    <Field data-invalid={!!errors[name]}>
      <FieldLabel htmlFor={name}>{t(name)}</FieldLabel>
      <select
        id={name}
        aria-invalid={!!errors[name]}
        disabled={disabled}
        className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30"
        {...form.register(name)}
      >
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <FieldError>{fieldError(errors[name]?.message)}</FieldError>
    </Field>
  );

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      {readOnly && (
        <p role="status" className="mb-6 rounded-lg border bg-muted/40 p-3 text-sm">
          {t("readOnly")}
        </p>
      )}
      <fieldset disabled={readOnly || isSubmitting} className="min-w-0">
        <FieldGroup>
          {text("name")}
          <div className="grid gap-6 sm:grid-cols-2">
            {text("addressLine", { autoComplete: "street-address" })}
            {text("city", { autoComplete: "address-level2" })}
            {text("postalCode", { autoComplete: "postal-code" })}
            {text("phone", { type: "tel", autoComplete: "tel" })}
          </div>

          <FieldSet>
            <FieldLegend variant="label">{t("coordinates")}</FieldLegend>
            <FieldDescription>{t("coordinatesHint")}</FieldDescription>
            <div className="grid gap-6 sm:grid-cols-2">
              {text("latitude", { inputMode: "decimal", placeholder: "40.1792" })}
              {text("longitude", { inputMode: "decimal", placeholder: "44.4991" })}
            </div>
            {!readOnly && (
              <>
                <FieldDescription>{t("pickOnMap")}</FieldDescription>
                <MapView
                  label={t("mapLabel")}
                  className="h-64 w-full overflow-hidden rounded-xl border"
                  pins={pin}
                  onPick={({ lat, lng }) => {
                    const options = { shouldDirty: true, shouldValidate: true };
                    form.setValue("latitude", lat.toFixed(6), options);
                    form.setValue("longitude", lng.toFixed(6), options);
                  }}
                />
              </>
            )}
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label">{t("openingHours")}</FieldLegend>
            <Controller
              control={form.control}
              name="openingHours"
              render={({ field }) => (
                <OpeningHoursEditor
                  emptyNote={t("hoursNoneSet")}
                  value={field.value ?? {}}
                  onChange={field.onChange}
                  disabled={readOnly || isSubmitting}
                />
              )}
            />
            <FieldError>
              {fieldError(firstMessage((errors as FieldErrors<FormValues>).openingHours))}
            </FieldError>
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label">{t("settings")}</FieldLegend>
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={field.value === "active"}
                    onChange={(e) => field.onChange(e.target.checked ? "active" : "inactive")}
                  />
                  {t("active")}
                </label>
              )}
            />
            <FieldDescription>{t("activeHint")}</FieldDescription>
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label">{t("billing")}</FieldLegend>
            <div className="grid gap-6 sm:grid-cols-2">
              {select(
                "serviceFeeBps",
                withCurrent(SERVICE_FEES, defaultValues.serviceFeeBps).map((bps) => [
                  String(bps),
                  bps === 0 ? t("noServiceFee") : `${bps / 100} %`,
                ]),
              )}
            </div>
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label">{t("reservations")}</FieldLegend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                {...form.register("reservationsEnabled")}
              />
              {t("reservationsEnabled")}
            </label>
            <div className="grid gap-6 sm:grid-cols-2">
              {select(
                "reservationConfirmation",
                RESERVATION_CONFIRMATION_MODES.map((mode) => [mode, t(`confirmation.${mode}`)]),
              )}
              {select(
                "reservationDurationMinutes",
                withCurrent(DURATIONS, defaultValues.reservationDurationMinutes).map((m) => [
                  String(m),
                  t("minutes", { count: m }),
                ]),
              )}
              {select(
                "reservationMinNoticeMinutes",
                withCurrent(NOTICES, defaultValues.reservationMinNoticeMinutes).map((m) => [
                  String(m),
                  m === 0 ? t("noNotice") : t("minutes", { count: m }),
                ]),
              )}
              {select(
                "reservationMaxDaysAhead",
                withCurrent(DAYS_AHEAD, defaultValues.reservationMaxDaysAhead).map((d) => [
                  String(d),
                  t("days", { count: d }),
                ]),
              )}
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              {select(
                "reservationDepositType",
                RESERVATION_DEPOSIT_TYPES.map((type) => [type, t(`depositType.${type}`)]),
                !paymentsEnabled && depositType === "none",
              )}
              {depositType !== "none" && (
                <Controller
                  control={form.control}
                  name="reservationDepositMinor"
                  render={({ field }) => (
                    <Field data-invalid={!!errors.reservationDepositMinor}>
                      <FieldLabel htmlFor="reservationDepositMinor">
                        {t(depositType === "per_guest" ? "depositPerGuest" : "depositPerBooking", {
                          currency,
                        })}
                      </FieldLabel>
                      <MoneyInput
                        id="reservationDepositMinor"
                        currency={currency}
                        value={field.value}
                        onChange={field.onChange}
                        invalid={!!errors.reservationDepositMinor}
                      />
                      <FieldError>{fieldError(errors.reservationDepositMinor?.message)}</FieldError>
                    </Field>
                  )}
                />
              )}
              {depositType !== "none" &&
                select(
                  "reservationRefundCutoffHours",
                  withCurrent(CUTOFF_HOURS, defaultValues.reservationRefundCutoffHours).map((h) => [
                    String(h),
                    h === 0 ? t("refundUntilStart") : t("refundHours", { count: h }),
                  ]),
                )}
            </div>
            {!paymentsEnabled && <FieldDescription>{t("depositUnavailable")}</FieldDescription>}
          </FieldSet>

          {!readOnly && (
            <Button type="submit" disabled={!isDirty || isSubmitting} className="self-start">
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
              {t("save")}
            </Button>
          )}
        </FieldGroup>
      </fieldset>
    </form>
  );
}

/** Amount typed in major units (3500, 3500.5), kept in minor units; invalid text → NaN. */
function MoneyInput({
  id,
  currency,
  value,
  onChange,
  invalid,
}: {
  id: string;
  currency: string;
  value: number | undefined;
  onChange: (minor: number) => void;
  invalid: boolean;
}) {
  const [text, setText] = useState(() =>
    value && Number.isFinite(value) ? toMajorUnits(value, currency) : "",
  );
  return (
    <Input
      id={id}
      inputMode="decimal"
      aria-invalid={invalid}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(toMinorUnits(e.target.value, currency) ?? Number.NaN);
      }}
    />
  );
}
