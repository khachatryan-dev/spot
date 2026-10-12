"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

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
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ARMENIA_VAT_BPS } from "@/shared/constants/bills";
import { CUISINES, MAX_CUISINES } from "@/shared/constants/cuisines";
import { restaurantProfileSchema } from "@/shared/schemas/restaurant";

import { updateRestaurantProfileAction } from "./actions";

type FormValues = z.input<typeof restaurantProfileSchema>;

const PRICE_LEVELS = [1, 2, 3, 4] as const;

const chip =
  "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function ProfileForm({
  restaurantId,
  defaultValues,
  readOnly,
}: {
  restaurantId: string;
  defaultValues: FormValues;
  readOnly: boolean;
}) {
  const t = useTranslations("Profile");
  const tc = useTranslations("Cuisines");
  const fieldError = useFieldError();
  const apiError = useApiError();
  const router = useRouter();

  const form = useForm<FormValues>({
    resolver: zodResolver(restaurantProfileSchema),
    defaultValues,
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  async function onSubmit(values: FormValues) {
    const result = await updateRestaurantProfileAction(restaurantId, values);
    if (result.error) {
      apiError.applyFieldErrors(result.error, form.setError);
      toast.error(apiError.message(result.error));
      return;
    }
    form.reset(values);
    toast.success(t("saved"));
    router.refresh();
  }

  const text = (
    name: "name" | "phone" | "email" | "website",
    type = "text",
    autoComplete = "off",
  ) => (
    <Field data-invalid={!!errors[name]}>
      <FieldLabel htmlFor={name}>{t(`fields.${name}`)}</FieldLabel>
      <Input
        id={name}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={!!errors[name]}
        {...form.register(name)}
      />
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
          <Field data-invalid={!!errors.description}>
            <FieldLabel htmlFor="description">{t("fields.description")}</FieldLabel>
            <Textarea id="description" rows={5} {...form.register("description")} />
            <FieldError>{fieldError(errors.description?.message)}</FieldError>
          </Field>

          <Controller
            control={form.control}
            name="cuisines"
            render={({ field }) => {
              const selected = field.value ?? [];
              return (
                <FieldSet>
                  <FieldLegend variant="label">{t("fields.cuisines")}</FieldLegend>
                  <FieldDescription>{t("cuisinesHint", { max: MAX_CUISINES })}</FieldDescription>
                  <div className="flex flex-wrap gap-2">
                    {CUISINES.map((cuisine) => {
                      const on = selected.includes(cuisine);
                      return (
                        <button
                          key={cuisine}
                          type="button"
                          aria-pressed={on}
                          disabled={!on && selected.length >= MAX_CUISINES}
                          onClick={() =>
                            field.onChange(
                              on ? selected.filter((c) => c !== cuisine) : [...selected, cuisine],
                            )
                          }
                          className={cn(
                            chip,
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "hover:bg-muted",
                          )}
                        >
                          {tc(cuisine)}
                        </button>
                      );
                    })}
                  </div>
                </FieldSet>
              );
            }}
          />

          <Controller
            control={form.control}
            name="priceRange"
            render={({ field }) => (
              <FieldSet>
                <FieldLegend variant="label">{t("fields.priceRange")}</FieldLegend>
                <div role="radiogroup" aria-label={t("fields.priceRange")} className="flex gap-2">
                  {PRICE_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={field.value === level}
                      aria-label={t(`price.${level}`)}
                      onClick={() => field.onChange(field.value === level ? null : level)}
                      className={cn(
                        chip,
                        "min-w-14",
                        field.value === level
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-muted",
                      )}
                    >
                      {"֏".repeat(level)}
                    </button>
                  ))}
                </div>
              </FieldSet>
            )}
          />

          <Controller
            control={form.control}
            name="vatRateBps"
            render={({ field }) => (
              <Field orientation="horizontal">
                <input
                  id="vatPayer"
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={field.value === ARMENIA_VAT_BPS}
                  onChange={(e) => field.onChange(e.target.checked ? ARMENIA_VAT_BPS : 0)}
                />
                <FieldLabel htmlFor="vatPayer" className="font-normal">
                  {t("fields.vatPayer")}
                </FieldLabel>
              </Field>
            )}
          />

          <div className="grid gap-6 sm:grid-cols-2">
            {text("phone", "tel", "tel")}
            {text("email", "email", "email")}
          </div>
          {text("website", "url", "url")}

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
