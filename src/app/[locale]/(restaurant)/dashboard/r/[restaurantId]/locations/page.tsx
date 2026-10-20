import { MapPin } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/shared/empty-state";
import { AddLocationForm } from "@/features/restaurant-onboarding/add-location-form";
import { LocationList } from "@/features/restaurant-locations/location-list";
import { resolveLocale } from "@/i18n/locale";
import { guardPage, requireUser } from "@/server/auth/guards";
import { getRestaurantAccess } from "@/server/policies/restaurant-access";
import { listLocations } from "@/server/services/location-service";
import { roleHasPermission } from "@/shared/auth/permissions";

export default async function LocationsPage({
  params,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/locations">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const { locations, canManage } = await guardPage(locale, async () => {
    const user = await requireUser();
    const locations = await listLocations(user, restaurantId);
    const access = await getRestaurantAccess(user.id, restaurantId);
    return {
      locations,
      canManage:
        !!access &&
        roleHasPermission(access.role, "location:manage") &&
        access.restaurantStatus !== "closed",
    };
  });
  const t = await getTranslations("Locations");

  return (
    <div className="flex flex-col gap-6">
      {locations.length === 0 && <EmptyState icon={MapPin}>{t("empty")}</EmptyState>}
      <LocationList restaurantId={restaurantId} locations={locations} />
      {canManage && (
        <section className="flex flex-col gap-4 border-t pt-6" aria-labelledby="add-location">
          <h2 id="add-location" className="text-lg font-medium">
            {t("addTitle")}
          </h2>
          <AddLocationForm restaurantId={restaurantId} />
        </section>
      )}
    </div>
  );
}
