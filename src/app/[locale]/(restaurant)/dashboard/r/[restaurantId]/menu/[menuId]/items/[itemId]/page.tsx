import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ImageUploader } from "@/components/shared/image-uploader";
import { ItemForm } from "@/features/menu-editor/item-form";
import { loadItemEditor } from "@/features/menu-editor/load-item-editor";
import { ModifierGroupsEditor } from "@/features/menu-editor/modifier-groups-editor";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage } from "@/server/auth/guards";
import { getItem } from "@/server/services/menu-service";
import { clientEnv } from "@/shared/config/env.client";
import { imageUrl } from "@/shared/utils/image-url";
import { toMajorUnits } from "@/shared/utils/money";

export default async function EditItemPage({
  params,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/menu/[menuId]/items/[itemId]">) {
  const locale = await resolveLocale(params);
  const { restaurantId, menuId, itemId } = await params;
  const { item, ...data } = await guardPage(locale, async () => {
    const editor = await loadItemEditor(restaurantId, menuId);
    const item = await getItem(editor.user, restaurantId, itemId);
    return { ...editor, item };
  });
  const t = await getTranslations("Menu.item");
  const groups =
    data.tree.categories
      .flatMap((c) => c.items)
      .find((i) => i.id === item.id)
      ?.modifierGroups.map((g) => ({
        id: g.id,
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        modifiers: g.modifiers.map(({ id, name, priceDeltaMinor, isDefault, isAvailable }) => ({
          id,
          name,
          priceDeltaMinor,
          isDefault,
          isAvailable,
        })),
      })) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/dashboard/r/${restaurantId}/menu/${menuId}`}
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      <h2 className="text-xl font-semibold">{item.name}</h2>
      {clientEnv.NEXT_PUBLIC_STORAGE_URL && (
        <ImageUploader
          id="item"
          endpoint={`/api/restaurants/${restaurantId}/menu-items/${item.id}/image`}
          label={t("photo")}
          shape="square"
          url={imageUrl(item.imageKey)}
          readOnly={!data.canManage}
        />
      )}
      <ItemForm
        restaurantId={restaurantId}
        menuId={menuId}
        itemId={item.id}
        currency={data.currency}
        categories={data.categories}
        readOnly={!data.canManage}
        defaultValues={{
          categoryId: item.categoryId,
          name: item.name,
          price: toMajorUnits(item.priceMinor, data.currency),
          description: item.description ?? "",
          ingredients: item.ingredients ?? "",
          allergens: item.allergens,
          dietaryTags: item.dietaryTags,
          prepTimeMinutes: item.prepTimeMinutes?.toString() ?? "",
          isActive: item.isActive,
          isAvailable: item.isAvailable,
        }}
      />
      <div className="border-t pt-6">
        <ModifierGroupsEditor
          restaurantId={restaurantId}
          itemId={item.id}
          currency={data.currency}
          readOnly={!data.canManage}
          groups={groups}
        />
      </div>
    </div>
  );
}
