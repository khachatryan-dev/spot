import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { CategoryList } from "@/features/menu-editor/category-list";
import { ItemList } from "@/features/menu-editor/item-list";
import { MenuSettings } from "@/features/menu-editor/menu-settings";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requireUser } from "@/server/auth/guards";
import { getRestaurantAccess } from "@/server/policies/restaurant-access";
import { listLocations } from "@/server/services/location-service";
import { getMenuTree, listMenus } from "@/server/services/menu-service";
import { getRestaurant } from "@/server/services/restaurant-service";
import { roleHasPermission } from "@/shared/auth/permissions";
import { imageUrl } from "@/shared/utils/image-url";

export default async function MenuEditorPage({
  params,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/menu/[menuId]">) {
  const locale = await resolveLocale(params);
  const { restaurantId, menuId } = await params;
  const data = await guardPage(locale, async () => {
    const user = await requireUser();
    const [tree, menus, locations, access, restaurant] = await Promise.all([
      getMenuTree(user, restaurantId, menuId),
      listMenus(user, restaurantId),
      listLocations(user, restaurantId),
      getRestaurantAccess(user.id, restaurantId),
      getRestaurant(user, restaurantId),
    ]);
    return {
      tree,
      currency: restaurant.currency,
      locationIds: menus.find((m) => m.id === menuId)?.locationIds ?? [],
      locations: locations.map(({ id, name }) => ({ id, name })),
      canManage:
        !!access &&
        roleHasPermission(access.role, "menu:manage") &&
        access.restaurantStatus !== "closed",
    };
  });
  const t = await getTranslations("Menu");

  return (
    <div className="flex flex-col gap-8">
      <Link
        href={`/dashboard/r/${restaurantId}/menu`}
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("allMenus")}
      </Link>
      <MenuSettings
        restaurantId={restaurantId}
        menu={{
          id: data.tree.id,
          name: data.tree.name,
          isActive: data.tree.isActive,
          locationIds: data.locationIds,
          availableHours: data.tree.availableHours,
        }}
        locations={data.locations}
        readOnly={!data.canManage}
      />
      <CategoryList
        restaurantId={restaurantId}
        menuId={data.tree.id}
        readOnly={!data.canManage}
        categories={data.tree.categories.map((c) => ({
          id: c.id,
          name: c.name,
          isActive: c.isActive,
          itemCount: c.items.length,
        }))}
      />
      {data.tree.categories.length > 0 && (
        <section className="flex flex-col gap-6 border-t pt-6" aria-labelledby="items-title">
          <h2 id="items-title" className="text-lg font-medium">
            {t("itemsTitle")}
          </h2>
          {data.tree.categories.map((category) => (
            <ItemList
              key={category.id}
              restaurantId={restaurantId}
              menuId={data.tree.id}
              categoryId={category.id}
              categoryName={category.name}
              currency={data.currency}
              readOnly={!data.canManage}
              items={category.items.map((item) => ({
                id: item.id,
                name: item.name,
                priceMinor: item.priceMinor,
                imageUrl: imageUrl(item.imageKey),
                isActive: item.isActive,
                isAvailable: item.isAvailable,
              }))}
            />
          ))}
        </section>
      )}
    </div>
  );
}
