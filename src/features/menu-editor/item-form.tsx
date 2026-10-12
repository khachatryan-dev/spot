"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import { ALLERGENS, DIETARY_TAGS } from "@/shared/constants/menu";
import { itemSchema } from "@/shared/schemas/menu";
import { toMinorUnits } from "@/shared/utils/money";

import { createItemAction, deleteItemAction, updateItemAction } from "./actions";

const chip =
  "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The form works in major units ("3500"); the server only ever sees integer minor units. */
function formSchema(currency: string) {
  return itemSchema.omit({ priceMinor: true, prepTimeMinutes: true }).extend({
    price: z.string().refine((v) => toMinorUnits(v, currency) !== null, "priceInvalid"),
    prepTimeMinutes: z.string().regex(/^(\d{1,3})?$/, "invalid"),
  });
}
export type ItemFormValues = z.input<ReturnType<typeof formSchema>>;

export function ItemForm({
  restaurantId,
  menuId,
  itemId,
  currency,
  categories,
  defaultValues,
  readOnly,
}: {
  restaurantId: string;
  menuId: string;
  /** Undefined when creating. */
  itemId?: string;
  currency: string;
  categories: { id: string; name: string }[];
  defaultValues: ItemFormValues;
  readOnly: boolean;
}) {
  const t = useTranslations("Menu.item");
  const ta = useTranslations("Allergens");
  const td = useTranslations("Dietary");
  const fieldError = useFieldError();
  const apiError = useApiError();
  const router = useRouter();
  const schema = useMemo(() => formSchema(currency), [currency]);
  const form = useForm<ItemFormValues>({ resolver: zodResolver(schema), defaultValues });
  const { errors, isSubmitting, isDirty } = form.formState;
  const editorUrl = `/dashboard/r/${restaurantId}/menu/${menuId}`;

  async function onSubmit({ price, prepTimeMinutes, ...values }: ItemFormValues) {
    const input = {
      ...values,
      priceMinor: toMinorUnits(price, currency)!,
      prepTimeMinutes: prepTimeMinutes ? Number(prepTimeMinutes) : null,
    };
    const result = itemId
      ? await updateItemAction(restaurantId, itemId, input)
      : await createItemAction(restaurantId, input);
    if (result.error) {
      apiError.applyFieldErrors(result.error, form.setError);
      toast.error(apiError.message(result.error));
      return;
    }
    toast.success(t("saved"));
    if (itemId) {
      form.reset({ price, prepTimeMinutes, ...values });
      router.refresh();
    } else if ("id" in result.data) {
      // Go to the new item so a photo can be added.
      router.replace(`${editorUrl}/items/${result.data.id}`);
    }
  }

  async function remove() {
    if (!itemId || !window.confirm(t("deleteConfirm", { name: defaultValues.name ?? "" }))) return;
    const result = await deleteItemAction(restaurantId, itemId);
    if (result.error) return void toast.error(apiError.message(result.error));
    toast.success(t("deleted"));
    router.replace(editorUrl);
  }

  const chips = <T extends string>(
    name: "allergens" | "dietaryTags",
    values: readonly T[],
    label: (v: T) => string,
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => {
        const selected = (field.value ?? []) as T[];
        return (
          <div className="flex flex-wrap gap-2">
            {values.map((value) => {
              const on = selected.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    field.onChange(on ? selected.filter((v) => v !== value) : [...selected, value])
                  }
                  className={cn(
                    chip,
                    on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {label(value)}
                </button>
              );
            })}
          </div>
        );
      }}
    />
  );

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <fieldset disabled={readOnly || isSubmitting} className="min-w-0">
        <FieldGroup>
          <div className="grid gap-6 sm:grid-cols-[1fr_12rem]">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="item-name">{t("name")}</FieldLabel>
              <Input id="item-name" aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError>{fieldError(errors.name?.message)}</FieldError>
            </Field>
            <Field data-invalid={!!errors.price}>
              <FieldLabel htmlFor="item-price">{t("price", { currency })}</FieldLabel>
              <Input
                id="item-price"
                inputMode="decimal"
                aria-invalid={!!errors.price}
                {...form.register("price")}
              />
              <FieldError>{fieldError(errors.price?.message)}</FieldError>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="item-category">{t("category")}</FieldLabel>
            <select
              id="item-category"
              className="h-8 rounded-lg border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...form.register("categoryId")}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="item-description">{t("description")}</FieldLabel>
            <Textarea id="item-description" rows={3} {...form.register("description")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="item-ingredients">{t("ingredients")}</FieldLabel>
            <Textarea id="item-ingredients" rows={2} {...form.register("ingredients")} />
          </Field>
          <FieldSet>
            <FieldLegend variant="label">{t("allergens")}</FieldLegend>
            <FieldDescription>{t("allergensHint")}</FieldDescription>
            {chips("allergens", ALLERGENS, (a) => ta(a))}
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">{t("dietary")}</FieldLegend>
            {chips("dietaryTags", DIETARY_TAGS, (d) => td(d))}
          </FieldSet>
          <Field data-invalid={!!errors.prepTimeMinutes} className="max-w-48">
            <FieldLabel htmlFor="item-prep">{t("prepTime")}</FieldLabel>
            <Input id="item-prep" inputMode="numeric" {...form.register("prepTimeMinutes")} />
            <FieldError>{fieldError(errors.prepTimeMinutes?.message)}</FieldError>
          </Field>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                {...form.register("isActive")}
              />
              {t("isActive")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                {...form.register("isAvailable")}
              />
              {t("isAvailable")}
            </label>
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={isSubmitting || (!!itemId && !isDirty)}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                {itemId ? t("save") : t("create")}
              </Button>
              {itemId && (
                <Button type="button" variant="ghost" onClick={remove}>
                  <Trash2 aria-hidden />
                  {t("delete")}
                </Button>
              )}
            </div>
          )}
        </FieldGroup>
      </fieldset>
    </form>
  );
}
