"use client";

import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";

import { createMenuAction } from "./actions";
import { useRun } from "./use-run";

export function CreateMenuForm({
  restaurantId,
  locationIds,
}: {
  restaurantId: string;
  locationIds: string[];
}) {
  const t = useTranslations("Menu");
  const router = useRouter();
  const { busy, run } = useRun();
  const [name, setName] = useState(t("defaultName"));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // A new menu is served at all locations; this can be changed in its settings.
    const created = await run("create", () =>
      createMenuAction(restaurantId, { name, locationIds }),
    );
    if (created) router.push(`/dashboard/r/${restaurantId}/menu/${created.id}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field className="flex-1">
        <FieldLabel htmlFor="menu-name">{t("menuName")}</FieldLabel>
        <Input
          id="menu-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
        />
      </Field>
      <Button type="submit" disabled={busy !== null || name.trim() === ""}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
        {t("createMenu")}
      </Button>
    </form>
  );
}
