import { Clock } from "lucide-react";
import { getTranslations } from "next-intl/server";

import type { CustomerMenu } from "@/server/services/customer-menu-service";

import { CartBar } from "./cart-bar";
import { CartScope } from "./cart-context";
import { CategoryNav } from "./category-nav";
import { MenuItemCard } from "./menu-item-card";

/** The guest-facing menu: mobile-first, server-rendered sections (§35). */
export async function MenuView({
  menus,
  currency,
  sessionId,
}: {
  menus: CustomerMenu[];
  currency: string;
  sessionId: string;
}) {
  const t = await getTranslations("CustomerMenu");

  if (menus.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center">
        <Clock className="size-8 text-muted-foreground" aria-hidden />
        <h2 className="font-medium">{t("closedTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("closedDescription")}</p>
      </div>
    );
  }

  const categories = menus.flatMap((menu) => menu.categories);
  return (
    <CartScope sessionId={sessionId} currency={currency} menus={menus}>
      <div className="flex flex-col gap-6">
        <CategoryNav categories={categories.map(({ id, name }) => ({ id, name }))} />
        {menus.map((menu) => (
          <div key={menu.id} className="flex flex-col gap-6">
            {menus.length > 1 && <h2 className="text-lg font-semibold">{menu.name}</h2>}
            {menu.categories.map((category) => (
              <section
                key={category.id}
                id={`cat-${category.id}`}
                aria-labelledby={`cat-title-${category.id}`}
                className="flex scroll-mt-14 flex-col gap-3"
              >
                <h3 id={`cat-title-${category.id}`} className="text-lg font-semibold">
                  {category.name}
                </h3>
                {category.description && (
                  <p className="-mt-2 text-sm text-muted-foreground">{category.description}</p>
                )}
                <ul className="flex flex-col divide-y">
                  {category.items.map((item) => (
                    <li key={item.id}>
                      <MenuItemCard item={item} currency={currency} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ))}
      </div>
      <CartBar />
    </CartScope>
  );
}
