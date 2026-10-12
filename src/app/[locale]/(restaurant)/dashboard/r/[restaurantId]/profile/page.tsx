import { resolveLocale } from "@/i18n/locale";
import { getTranslations } from "next-intl/server";

import { ImageUploader } from "@/components/shared/image-uploader";
import { ProfileForm } from "@/features/restaurant-profile/profile-form";
import { guardPage, requireUser } from "@/server/auth/guards";
import { getRestaurantAccess } from "@/server/policies/restaurant-access";
import { getRestaurant } from "@/server/services/restaurant-service";
import { roleHasPermission } from "@/shared/auth/permissions";
import { clientEnv } from "@/shared/config/env.client";
import { imageUrl } from "@/shared/utils/image-url";
import { ARMENIA_VAT_BPS } from "@/shared/constants/bills";

export default async function RestaurantProfilePage({
  params,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/profile">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const { restaurant, canEdit } = await guardPage(locale, async () => {
    const user = await requireUser();
    const restaurant = await getRestaurant(user, restaurantId);
    const access = await getRestaurantAccess(user.id, restaurantId);
    return {
      restaurant,
      canEdit:
        !!access &&
        roleHasPermission(access.role, "restaurant:update") &&
        restaurant.status !== "closed",
    };
  });

  const t = await getTranslations("Profile.images");
  const uploadsEnabled = !!clientEnv.NEXT_PUBLIC_STORAGE_URL;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" aria-label={t("title")}>
        {uploadsEnabled ? (
          <div className="flex flex-col gap-6 sm:flex-row">
            <ImageUploader
              id="logo"
              endpoint={`/api/restaurants/${restaurant.id}/images/logo`}
              label={t("logo")}
              shape="square"
              url={imageUrl(restaurant.logoKey)}
              readOnly={!canEdit}
            />
            <div className="flex-1">
              <ImageUploader
                id="cover"
                endpoint={`/api/restaurants/${restaurant.id}/images/cover`}
                label={t("cover")}
                shape="wide"
                url={imageUrl(restaurant.coverImageKey)}
                readOnly={!canEdit}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("notConfigured")}</p>
        )}
        {canEdit && uploadsEnabled && <p className="text-sm text-muted-foreground">{t("hint")}</p>}
      </section>
      <ProfileForm
        restaurantId={restaurant.id}
        readOnly={!canEdit}
        defaultValues={{
          name: restaurant.name,
          description: restaurant.description ?? "",
          cuisines: restaurant.cuisines,
          priceRange: restaurant.priceRange,
          vatRateBps: restaurant.vatRateBps === ARMENIA_VAT_BPS ? ARMENIA_VAT_BPS : 0,
          phone: restaurant.phone ?? "",
          email: restaurant.email ?? "",
          website: restaurant.website ?? "",
        }}
      />
    </div>
  );
}
