"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { useApiError } from "@/components/shared/use-api-error";
import { useFieldError } from "@/components/shared/use-field-error";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CONTACT_TOPICS, type ContactTopic } from "@/shared/constants/contact";
import { type ContactInput, contactSchema } from "@/shared/schemas/contact";

import { sendContactMessageAction } from "./actions";

export function ContactForm({ initialTopic }: { initialTopic: ContactTopic }) {
  const t = useTranslations("Contact.form");
  const fieldError = useFieldError();
  const apiError = useApiError();
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const form = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: "", email: "", topic: initialTopic, message: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: ContactInput) {
    setFormError(null);
    const result = await sendContactMessageAction(values);
    if (result.error) {
      apiError.applyFieldErrors(result.error, form.setError);
      setFormError(apiError.message(result.error));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-2xl bg-emerald-50 p-8 text-center motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in dark:bg-emerald-950/40"
      >
        <CheckCircle2 className="size-12 text-emerald-700 dark:text-emerald-300" aria-hidden />
        <p className="text-lg font-semibold">{t("sentTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("sentText")}</p>
        <Button
          variant="outline"
          onClick={() => {
            form.reset();
            setSent(false);
          }}
        >
          {t("another")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">{t("topic")}</FieldLegend>
          <div className="grid grid-cols-2 gap-2">
            {CONTACT_TOPICS.map((topic) => (
              <label
                key={topic}
                className="flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition-colors has-checked:border-primary has-checked:bg-orange-50 has-focus-visible:ring-3 has-focus-visible:ring-ring/50 dark:has-checked:bg-orange-950/40"
              >
                <input
                  type="radio"
                  value={topic}
                  className="accent-primary"
                  {...form.register("topic")}
                />
                {t(`topics.${topic}`)}
              </label>
            ))}
          </div>
        </FieldSet>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="contact-name">{t("name")}</FieldLabel>
            <Input
              id="contact-name"
              autoComplete="name"
              aria-invalid={!!errors.name}
              {...form.register("name")}
            />
            <FieldError>{fieldError(errors.name?.message)}</FieldError>
          </Field>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="contact-email">{t("email")}</FieldLabel>
            <Input
              id="contact-email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...form.register("email")}
            />
            <FieldError>{fieldError(errors.email?.message)}</FieldError>
          </Field>
        </div>
        <Field data-invalid={!!errors.message}>
          <FieldLabel htmlFor="contact-message">{t("message")}</FieldLabel>
          <Textarea
            id="contact-message"
            rows={5}
            aria-invalid={!!errors.message}
            {...form.register("message")}
          />
          <FieldError>{fieldError(errors.message?.message)}</FieldError>
        </Field>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" disabled={isSubmitting} className="h-10 self-start px-5">
          {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          {t("send")}
        </Button>
      </FieldGroup>
    </form>
  );
}
