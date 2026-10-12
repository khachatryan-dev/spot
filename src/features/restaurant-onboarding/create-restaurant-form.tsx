"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useApiError } from "@/components/shared/use-api-error";
import { useFieldError } from "@/components/shared/use-field-error";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { createRestaurantSchema } from "@/shared/schemas/restaurant";

import { createRestaurantAction } from "./actions";

const formSchema = createRestaurantSchema.pick({ name: true, phone: true, description: true });
type FormValues = z.input<typeof formSchema>;

export function CreateRestaurantForm() {
  const t = useTranslations("Onboarding.create");
  const fieldError = useFieldError();
  const apiError = useApiError();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", phone: "", description: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: FormValues) {
    setFormError(null);
    const result = await createRestaurantAction(values);
    if (result.error) {
      apiError.applyFieldErrors(result.error, form.setError);
      setFormError(apiError.message(result.error));
      return;
    }
    router.push(`/dashboard/r/${result.data.id}`);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-lg">
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">{t("name")}</FieldLabel>
          <Input id="name" aria-invalid={!!errors.name} {...form.register("name")} />
          {errors.name ? (
            <FieldError>{fieldError(errors.name.message)}</FieldError>
          ) : (
            <FieldDescription>{t("nameHint")}</FieldDescription>
          )}
        </Field>
        <Field data-invalid={!!errors.phone}>
          <FieldLabel htmlFor="phone">{t("phone")}</FieldLabel>
          <Input id="phone" type="tel" autoComplete="tel" {...form.register("phone")} />
          <FieldError>{fieldError(errors.phone?.message)}</FieldError>
        </Field>
        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="description">{t("description")}</FieldLabel>
          <Textarea id="description" rows={4} {...form.register("description")} />
          <FieldError>{fieldError(errors.description?.message)}</FieldError>
        </Field>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <Button type="submit" disabled={isSubmitting} className="self-start">
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          {t("submit")}
        </Button>
      </FieldGroup>
    </form>
  );
}
