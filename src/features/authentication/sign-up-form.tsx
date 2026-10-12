"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { signUpSchema, type SignUpInput } from "@/shared/schemas/auth";

import { authErrorKey, type AuthErrorKey } from "./auth-error";
import { useErrorMessage } from "./use-error-message";

export function SignUpForm({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [formError, setFormError] = useState<AuthErrorKey | null>(null);

  const form = useForm<z.input<typeof signUpSchema>, unknown, SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: SignUpInput) {
    setFormError(null);
    const { error } = await authClient.signUp.email({ ...values, preferredLocale: locale });
    if (error) {
      setFormError(authErrorKey(error));
      return;
    }
    router.replace(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">{t("fields.name")}</FieldLabel>
          <Input
            id="name"
            autoComplete="name"
            aria-invalid={!!errors.name}
            {...form.register("name")}
          />
          <FieldError>{errorMessage(errors.name?.message)}</FieldError>
        </Field>
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">{t("fields.email")}</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            aria-invalid={!!errors.email}
            {...form.register("email")}
          />
          <FieldError>{errorMessage(errors.email?.message)}</FieldError>
        </Field>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">{t("fields.password")}</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby="password-hint"
            {...form.register("password")}
          />
          {errors.password ? (
            <FieldError>{errorMessage(errors.password.message)}</FieldError>
          ) : (
            <FieldDescription id="password-hint">{t("fields.passwordHint")}</FieldDescription>
          )}
        </Field>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${formError}`)}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          {t("signUp.submit")}
        </Button>
      </FieldGroup>
    </form>
  );
}
