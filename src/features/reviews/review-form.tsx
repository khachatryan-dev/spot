"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useApiError } from "@/components/shared/use-api-error";
import { useFieldError } from "@/components/shared/use-field-error";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";

import { createReviewAction } from "./actions";
import { StarRatingInput } from "./star-rating-input";

/** Rate one completed visit or reservation. Anonymous guests also leave an email. */
export function ReviewForm({
  subject,
  targetId,
  heading,
  anonymous,
}: {
  subject: "visit" | "reservation";
  targetId: string;
  heading: string;
  anonymous: boolean;
}) {
  const t = useTranslations("Reviews");
  const fieldError = useFieldError();
  const apiError = useApiError();
  const router = useRouter();
  const [rating, setRating] = useState<number>();
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const id = (field: string) => `${targetId}-${field}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!rating) {
      setErrors({ rating: "ratingRequired" });
      return;
    }
    setSaving(true);
    const result = await createReviewAction({
      subject,
      targetId,
      rating,
      comment,
      ...(anonymous && { email, displayName: name }),
    });
    setSaving(false);
    if (result.error) {
      const fields = result.error.fieldErrors ?? {};
      setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[0]])));
      toast.error(apiError.message(result.error));
      return;
    }
    toast.success(t("thanks"));
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={id("heading")}
      className="flex flex-col gap-3 rounded-2xl border p-4"
    >
      <h2 id={id("heading")} className="font-semibold">
        {heading}
      </h2>
      <FieldGroup>
        <div>
          <StarRatingInput
            name={id("rating")}
            value={rating}
            onChange={setRating}
            invalid={!!errors.rating}
          />
          {errors.rating && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {fieldError(errors.rating)}
            </p>
          )}
        </div>
        <Field data-invalid={!!errors.comment}>
          <FieldLabel htmlFor={id("comment")}>{t("commentLabel")}</FieldLabel>
          <Textarea
            id={id("comment")}
            rows={3}
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("commentPlaceholder")}
          />
          <FieldError>{fieldError(errors.comment)}</FieldError>
        </Field>
        {anonymous && (
          <>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor={id("email")}>{t("emailLabel")}</FieldLabel>
              <Input
                id={id("email")}
                type="email"
                inputMode="email"
                autoComplete="email"
                aria-invalid={!!errors.email}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("emailHint")}</p>
              <FieldError>{fieldError(errors.email)}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor={id("name")}>{t("nameLabel")}</FieldLabel>
              <Input
                id={id("name")}
                autoComplete="given-name"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </>
        )}
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          {t("submit")}
        </Button>
      </FieldGroup>
    </form>
  );
}
