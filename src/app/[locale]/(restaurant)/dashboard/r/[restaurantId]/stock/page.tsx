import { getTranslations } from "next-intl/server";

import { StockList } from "@/features/menu-editor/stock-list";
import { resolveLocale } from "@/i18n/locale";
import { guardPage, requireUser } from "@/server/auth/guards";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { getMenuTree, listMenus } from "@/server/services/menu-service";

/** Quick in/out-of-stock screen for service (kitchen, managers, owners). */
export default async function StockPage({
  params,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/stock">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const categories = await guardPage(locale, async () => {
    const user = await requireUser();
    await authorizeRestaurant(user.id, restaurantId, "menu:availability");
    const menus = (await listMenus(user, restaurantId)).filter((m) => m.isActive);
    const trees = await Promise.all(menus.map((m) => getMenuTree(user, restaurantId, m.id)));
    return trees.flatMap((tree) =>
      tree.categories
        .filter((c) => c.isActive)
        .map((c) => ({
          id: c.id,
          name: menus.length > 1 ? `${tree.name} · ${c.name}` : c.name,
          items: c.items
            .filter((i) => i.isActive)
            .map((i) => ({
              id: i.id,
              name: i.name,
              isAvailable: i.isAvailable,
              modifiers: i.modifierGroups.flatMap((g) =>
                g.modifiers.map((m) => ({ id: m.id, name: m.name, isAvailable: m.isAvailable })),
              ),
            })),
        }))
        .filter((c) => c.items.length > 0),
    );
  });
  const t = await getTranslations("Stock");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <StockList restaurantId={restaurantId} categories={categories} />
    </div>
  );
}
