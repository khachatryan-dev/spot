import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { BookingLink } from "@/features/reservations/booking-link";
import { LocationForm } from "@/features/restaurant-locations/location-form";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requireUser } from "@/server/auth/guards";
import { getRestaurantAccess } from "@/server/policies/restaurant-access";
import { getLocation } from "@/server/services/location-service";
import { paymentsAvailable } from "@/server/payments/registry";
import { getRestaurant } from "@/server/services/restaurant-service";
import { roleHasPermission } from "@/shared/auth/permissions";
import { bookingUrl } from "@/shared/utils/booking-url";

export default async function LocationPage({
  params,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/locations/[locationId]">) {
  const locale = await resolveLocale(params);
  const { restaurantId, locationId } = await params;
  const { location, restaurant, canManage } = await guardPage(locale, async () => {
    const user = await requireUser();
    const location = await getLocation(user, restaurantId, locationId);
    const restaurant = await getRestaurant(user, restaurantId);
    const access = await getRestaurantAccess(user.id, restaurantId);
    return {
      location,
      restaurant,
      canManage:
        !!access &&
        roleHasPermission(access.role, "location:manage") &&
        access.restaurantStatus !== "closed",
    };
  });
  const t = await getTranslations("Locations");

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/dashboard/r/${restaurantId}/locations`}
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      <h2 className="text-xl font-semibold">{location.name}</h2>
      {restaurant.status === "active" &&
        location.status === "active" &&
        location.reservationsEnabled && (
          <BookingLink url={bookingUrl(restaurant.slug, location.slug)} />
        )}
      <LocationForm
        restaurantId={restaurantId}
        locationId={location.id}
        readOnly={!canManage}
        currency={restaurant.currency}
        paymentsEnabled={paymentsAvailable()}
        defaultValues={{
          name: location.name,
          addressLine: location.addressLine,
          city: location.city,
          postalCode: location.postalCode ?? "",
          phone: location.phone ?? "",
          latitude: location.latitude?.toString() ?? "",
          longitude: location.longitude?.toString() ?? "",
          openingHours: location.openingHours,
          reservationsEnabled: location.reservationsEnabled,
          reservationConfirmation: location.reservationConfirmation,
          reservationDurationMinutes: location.reservationDurationMinutes,
          reservationMinNoticeMinutes: location.reservationMinNoticeMinutes,
          reservationMaxDaysAhead: location.reservationMaxDaysAhead,
          reservationDepositType: location.reservationDepositType,
          reservationDepositMinor: location.reservationDepositMinor,
          reservationRefundCutoffHours: location.reservationRefundCutoffHours,
          serviceFeeBps: location.serviceFeeBps,
          status: location.status,
        }}
      />
    </div>
  );
}
