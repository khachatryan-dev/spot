import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ItemForm } from "@/features/menu-editor/item-form";
import { loadItemEditor } from "@/features/menu-editor/load-item-editor";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage } from "@/server/auth/guards";

export default async function NewItemPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/menu/[menuId]/items/new">) {
  const locale = await resolveLocale(params);
  const { restaurantId, menuId } = await params;
  const { category } = await searchParams;
  const data = await guardPage(locale, () => loadItemEditor(restaurantId, menuId));
  if (!data.canManage || data.categories.length === 0) notFound();
  const t = await getTranslations("Menu.item");
  const categoryId = data.categories.find((c) => c.id === category)?.id ?? data.categories[0]!.id;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/dashboard/r/${restaurantId}/menu/${menuId}`}
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      <h2 className="text-xl font-semibold">{t("newTitle")}</h2>
      <ItemForm
        restaurantId={restaurantId}
        menuId={menuId}
        currency={data.currency}
        categories={data.categories}
        readOnly={false}
        defaultValues={{
          categoryId,
          name: "",
          price: "",
          description: "",
          ingredients: "",
          allergens: [],
          dietaryTags: [],
          prepTimeMinutes: "",
          isActive: true,
          isAvailable: true,
        }}
      />
    </div>
  );
}
