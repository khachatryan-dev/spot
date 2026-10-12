import { CheckCircle2, Circle, Clock } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { LocationList } from "@/features/restaurant-locations/location-list";
import { AddLocationForm } from "@/features/restaurant-onboarding/add-location-form";
import { SubmitForReviewButton } from "@/features/restaurant-onboarding/submit-for-review-button";
import { resolveLocale } from "@/i18n/locale";
import { guardPage, requireUser } from "@/server/auth/guards";
import { getRestaurantAccess } from "@/server/policies/restaurant-access";
import { listLocations } from "@/server/services/location-service";
import { getRestaurant } from "@/server/services/restaurant-service";
import { roleHasPermission } from "@/shared/auth/permissions";

export default async function RestaurantSetupPage({
  params,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const { restaurant, locations, canManage } = await guardPage(locale, async () => {
    const user = await requireUser();
    const restaurant = await getRestaurant(user, restaurantId); // NOT_FOUND for other tenants → 404
    const locations = await listLocations(user, restaurantId);
    const access = await getRestaurantAccess(user.id, restaurantId);
    return {
      restaurant,
      locations,
      canManage: !!access && roleHasPermission(access.role, "restaurant:update"),
    };
  });
  const t = await getTranslations("Onboarding.setup");
  const hasLocation = locations.some((l) => l.status === "active");

  return (
    <div className="flex flex-col gap-8">
      {restaurant.status === "pending_review" && (
        <div role="status" className="flex gap-3 rounded-xl border bg-muted/40 p-4 text-sm">
          <Clock className="size-5 shrink-0" aria-hidden />
          <p>{t("pending")}</p>
        </div>
      )}
      {restaurant.status === "draft" && restaurant.statusReason && (
        <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm">
          <p className="font-medium">{t("rejected")}</p>
          <p className="text-muted-foreground">{restaurant.statusReason}</p>
        </div>
      )}

      {restaurant.status === "draft" && (
        <section className="flex flex-col gap-4" aria-labelledby="checklist">
          <h2 id="checklist" className="text-lg font-medium">
            {t("checklistTitle")}
          </h2>
          <ol className="flex flex-col gap-3">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-primary" aria-hidden />
              {t("stepProfile")}
            </li>
            <li className="flex items-center gap-2">
              {hasLocation ? (
                <CheckCircle2 className="size-5 text-primary" aria-hidden />
              ) : (
                <Circle className="size-5 text-muted-foreground" aria-hidden />
              )}
              {t("stepLocation")}
            </li>
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-4" aria-labelledby="locations">
        <h2 id="locations" className="text-lg font-medium">
          {t("locationsTitle")}
        </h2>
        <LocationList restaurantId={restaurant.id} locations={locations} />
        {canManage && restaurant.status === "draft" && locations.length === 0 && (
          <AddLocationForm restaurantId={restaurant.id} />
        )}
      </section>

      {canManage && restaurant.status === "draft" && (
        <section className="flex flex-col items-start gap-2 border-t pt-6">
          <SubmitForReviewButton restaurantId={restaurant.id} disabled={!hasLocation} />
          {!hasLocation && <p className="text-sm text-muted-foreground">{t("needsLocation")}</p>}
        </section>
      )}
    </div>
  );
}
