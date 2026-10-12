"use client";

import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  createCategoryAction,
  deleteCategoryAction,
  reorderCategoriesAction,
  updateCategoryAction,
} from "./actions";
import { useRun } from "./use-run";

export interface CategoryRow {
  id: string;
  name: string;
  isActive: boolean;
  itemCount: number;
}

export function CategoryList({
  restaurantId,
  menuId,
  categories,
  readOnly,
}: {
  restaurantId: string;
  menuId: string;
  categories: CategoryRow[];
  readOnly: boolean;
}) {
  const t = useTranslations("Menu.categories");
  const { busy, run } = useRun();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [newName, setNewName] = useState("");

  function move(index: number, by: -1 | 1) {
    const ids = categories.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    void run(`move-${moved}`, () => reorderCategoriesAction(restaurantId, menuId, ids));
  }

  async function rename(id: string, name: string) {
    if (await run(id, () => updateCategoryAction(restaurantId, id, { name }))) setEditing(null);
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (await run("new", () => createCategoryAction(restaurantId, menuId, { name: newName })))
      setNewName("");
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="categories-title">
      <h2 id="categories-title" className="text-lg font-medium">
        {t("title")}
      </h2>
      {categories.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      <ol className="flex flex-col divide-y rounded-xl border empty:hidden">
        {categories.map((category, index) => {
          const isEditing = editing?.id === category.id;
          const rowBusy = busy !== null;
          return (
            <li key={category.id} className="flex flex-wrap items-center gap-2 p-3">
              {isEditing ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename(category.id, editing.name);
                  }}
                >
                  <Input
                    autoFocus
                    aria-label={t("rename", { name: category.name })}
                    value={editing.name}
                    onChange={(e) => setEditing({ id: category.id, name: e.target.value })}
                    maxLength={120}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    variant="ghost"
                    aria-label={t("saveName")}
                    disabled={rowBusy || editing.name.trim() === ""}
                  >
                    <Check aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("cancel")}
                    onClick={() => setEditing(null)}
                  >
                    <X aria-hidden />
                  </Button>
                </form>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate font-medium">{category.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {t("itemCount", { count: category.itemCount })}
                  </span>
                  {!category.isActive && <Badge variant="outline">{t("hidden")}</Badge>}
                </div>
              )}
              {!readOnly && !isEditing && (
                <div className="flex items-center">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("moveUp", { name: category.name })}
                    disabled={rowBusy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("moveDown", { name: category.name })}
                    disabled={rowBusy || index === categories.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("rename", { name: category.name })}
                    disabled={rowBusy}
                    onClick={() => setEditing({ id: category.id, name: category.name })}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={
                      category.isActive
                        ? t("hide", { name: category.name })
                        : t("show", { name: category.name })
                    }
                    disabled={rowBusy}
                    onClick={() =>
                      run(category.id, () =>
                        updateCategoryAction(restaurantId, category.id, {
                          isActive: !category.isActive,
                        }),
                      )
                    }
                  >
                    {category.isActive ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("delete", { name: category.name })}
                    title={category.itemCount > 0 ? t("deleteBlocked") : undefined}
                    disabled={rowBusy || category.itemCount > 0}
                    onClick={() => {
                      if (window.confirm(t("deleteConfirm", { name: category.name }))) {
                        void run(
                          category.id,
                          () => deleteCategoryAction(restaurantId, category.id),
                          t("deleted"),
                        );
                      }
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!readOnly && (
        <form onSubmit={add} className="flex gap-2">
          <Input
            aria-label={t("newName")}
            placeholder={t("newPlaceholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={120}
          />
          <Button type="submit" variant="outline" disabled={busy !== null || newName.trim() === ""}>
            <Plus aria-hidden />
            {t("add")}
          </Button>
        </form>
      )}
    </section>
  );
}
