"use client";

import { ArrowDown, ArrowUp, ImageIcon, Plus } from "lucide-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/shared/utils/money";

import { reorderItemsAction } from "./actions";
import { useRun } from "./use-run";

export interface ItemRow {
  id: string;
  name: string;
  priceMinor: number;
  imageUrl: string | null;
  isActive: boolean;
  isAvailable: boolean;
}

/** Items of one category on the menu editor. */
export function ItemList({
  restaurantId,
  menuId,
  categoryId,
  categoryName,
  currency,
  items,
  readOnly,
}: {
  restaurantId: string;
  menuId: string;
  categoryId: string;
  categoryName: string;
  currency: string;
  items: ItemRow[];
  readOnly: boolean;
}) {
  const t = useTranslations("Menu.items");
  const locale = useLocale();
  const { busy, run } = useRun();
  const base = `/dashboard/r/${restaurantId}/menu/${menuId}/items`;

  function move(index: number, by: -1 | 1) {
    const ids = items.map((i) => i.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    void run(`move-${moved}`, () => reorderItemsAction(restaurantId, categoryId, ids));
  }

  return (
    <section className="flex flex-col gap-2" aria-label={categoryName}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{categoryName}</h3>
        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`${base}/new?category=${categoryId}`} />}
          >
            <Plus aria-hidden />
            {t("add", { category: categoryName })}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-3 p-2 pr-1">
              <Link
                href={`${base}/${item.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt=""
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="48px"
                    />
                  ) : (
                    <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                {!item.isActive && <Badge variant="outline">{t("hidden")}</Badge>}
                {item.isActive && !item.isAvailable && (
                  <Badge variant="secondary">{t("outOfStock")}</Badge>
                )}
                <span className="text-sm tabular-nums">
                  {formatMoney(item.priceMinor, currency, locale)}
                </span>
              </Link>
              {!readOnly && (
                <div className="flex">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("moveUp", { name: item.name })}
                    disabled={busy !== null || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("moveDown", { name: item.name })}
                    disabled={busy !== null || index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
