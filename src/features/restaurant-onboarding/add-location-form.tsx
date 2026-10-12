"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { useApiError } from "@/components/shared/use-api-error";
import { useFieldError } from "@/components/shared/use-field-error";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { createLocationSchema } from "@/shared/schemas/location";

import { createLocationAction } from "./actions";

type FormValues = z.input<typeof createLocationSchema>;
const FIELDS = [
  { name: "name", autoComplete: "off" },
  { name: "addressLine", autoComplete: "street-address" },
  { name: "city", autoComplete: "address-level2" },
  { name: "phone", autoComplete: "tel" },
] as const;

export function AddLocationForm({ restaurantId }: { restaurantId: string }) {
  const t = useTranslations("Onboarding.location");
  const fieldError = useFieldError();
  const apiError = useApiError();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(createLocationSchema),
    defaultValues: { name: "", addressLine: "", city: t("defaultCity"), phone: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: FormValues) {
    setFormError(null);
    const result = await createLocationAction(restaurantId, values);
    if (result.error) {
      apiError.applyFieldErrors(result.error, form.setError);
      setFormError(apiError.message(result.error));
      return;
    }
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map(({ name, autoComplete }) => (
          <Field key={name} data-invalid={!!errors[name]}>
            <FieldLabel htmlFor={`location-${name}`}>{t(name)}</FieldLabel>
            <Input
              id={`location-${name}`}
              autoComplete={autoComplete}
              type={name === "phone" ? "tel" : "text"}
              aria-invalid={!!errors[name]}
              {...form.register(name)}
            />
            <FieldError>{fieldError(errors[name]?.message)}</FieldError>
          </Field>
        ))}
        {formError && (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {formError}
          </p>
        )}
        <Button
          type="submit"
          variant="outline"
          disabled={isSubmitting}
          className="justify-self-start"
        >
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          {t("submit")}
        </Button>
      </FieldGroup>
    </form>
  );
}
