"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";

import { useApiError } from "@/components/shared/use-api-error";
import { useFieldError } from "@/components/shared/use-field-error";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { inviteStaffSchema } from "@/shared/schemas/staff";

import { inviteStaffAction } from "./actions";
import { RoleSelect } from "./role-select";

type FormValues = z.input<typeof inviteStaffSchema>;

export function InviteForm({ restaurantId }: { restaurantId: string }) {
  const t = useTranslations("Staff.invite");
  const fieldError = useFieldError();
  const apiError = useApiError();
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(inviteStaffSchema),
    defaultValues: { email: "", role: "waiter" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: FormValues) {
    setFormError(null);
    const result = await inviteStaffAction(restaurantId, values);
    if (result.error) {
      apiError.applyFieldErrors(result.error, form.setError);
      setFormError(apiError.message(result.error));
      return;
    }
    // Shown once: only the token's hash is stored.
    setLink(`${window.location.origin}/invite/${result.data.token}`);
    setCopied(false);
    form.reset({ email: "", role: values.role });
    router.refresh();
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        <Field data-invalid={!!errors.email} className="flex-1">
          <FieldLabel htmlFor="invite-email">{t("email")}</FieldLabel>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            aria-invalid={!!errors.email}
            {...form.register("email")}
          />
          <FieldError>{fieldError(errors.email?.message)}</FieldError>
        </Field>
        <Field className="sm:w-40">
          <FieldLabel htmlFor="invite-role">{t("role")}</FieldLabel>
          <Controller
            control={form.control}
            name="role"
            render={({ field }) => (
              <RoleSelect id="invite-role" value={field.value} onChange={field.onChange} />
            )}
          />
        </Field>
        <Button type="submit" disabled={isSubmitting} className="sm:mt-6">
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          {t("submit")}
        </Button>
      </form>
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      {link && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-4">
          <p className="text-sm font-medium">{t("linkTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("linkHint")}</p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={link}
              aria-label={t("linkTitle")}
              onFocus={(e) => e.target.select()}
            />
            <Button type="button" variant="outline" onClick={copy}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
