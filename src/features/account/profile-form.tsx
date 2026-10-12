"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { useApiError } from "@/components/shared/use-api-error";
import { useFieldError } from "@/components/shared/use-field-error";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { profileSchema } from "@/shared/schemas/account";

import { updateProfileAction } from "./actions";

type Values = z.input<typeof profileSchema>;

/** Name, phone (pre-fills bookings) and language (§25). */
export function ProfileForm({ defaults, email }: { defaults: Values; email: string }) {
  const t = useTranslations("Account");
  const fieldError = useFieldError();
  const apiError = useApiError();
  const router = useRouter();
  const form = useForm<Values, unknown, z.output<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: defaults,
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  async function onSubmit() {
    // The server validates again; send what was typed.
    const result = await updateProfileAction(form.getValues());
    if (result.error) {
      apiError.applyFieldErrors(result.error, form.setError);
      toast.error(apiError.message(result.error));
      return;
    }
    form.reset(form.getValues());
    toast.success(t("saved"));
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate aria-labelledby="profile-heading">
      <FieldGroup>
        <h2 id="profile-heading" className="text-lg font-semibold">
          {t("profileTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("signedInAs", { email })}</p>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">{t("name")}</FieldLabel>
          <Input
            id="name"
            autoComplete="name"
            aria-invalid={!!errors.name}
            {...form.register("name")}
          />
          <FieldError>{fieldError(errors.name?.message)}</FieldError>
        </Field>
        <Field data-invalid={!!errors.phone}>
          <FieldLabel htmlFor="phone">{t("phone")}</FieldLabel>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+374 91 000000"
            aria-invalid={!!errors.phone}
            {...form.register("phone")}
          />
          <p className="text-xs text-muted-foreground">{t("phoneHint")}</p>
          <FieldError>{fieldError(errors.phone?.message)}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="preferredLocale">{t("language")}</FieldLabel>
          <select
            id="preferredLocale"
            className="h-8 w-48 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            {...form.register("preferredLocale")}
          >
            {routing.locales.map((locale) => (
              <option key={locale} value={locale}>
                {t(`languages.${locale}`)}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" className="self-start" disabled={!isDirty || isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          {t("save")}
        </Button>
      </FieldGroup>
    </form>
  );
}
