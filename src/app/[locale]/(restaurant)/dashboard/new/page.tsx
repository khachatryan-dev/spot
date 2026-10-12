import { getTranslations } from "next-intl/server";

import { CreateRestaurantForm } from "@/features/restaurant-onboarding/create-restaurant-form";
import { resolveLocale } from "@/i18n/locale";
import { guardPage, requireUser } from "@/server/auth/guards";

export default async function NewRestaurantPage({ params }: PageProps<"/[locale]/dashboard/new">) {
  const locale = await resolveLocale(params);
  await guardPage(locale, requireUser);
  const t = await getTranslations("Onboarding.create");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <CreateRestaurantForm />
    </div>
  );
}
