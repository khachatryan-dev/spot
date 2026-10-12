import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { RestaurantStatusBadge } from "@/components/shared/restaurant-status-badge";
import { ReviewActions } from "@/features/admin-restaurants/review-actions";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requirePlatformPermission } from "@/server/auth/guards";
import { getRestaurantForReview } from "@/server/services/admin-restaurant-service";

export default async function AdminRestaurantPage({
  params,
}: PageProps<"/[locale]/admin/restaurants/[restaurantId]">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const { restaurant, locations, owners } = await guardPage(locale, async () =>
    getRestaurantForReview(
      await requirePlatformPermission("platform:restaurants:review"),
      restaurantId,
    ),
  );
  const t = await getTranslations("Admin.review");
  const cuisines = await getTranslations("Cuisines");

  const rows: [string, string | null][] = [
    [t("slug"), `/${restaurant.slug}`],
    [t("phone"), restaurant.phone],
    [t("email"), restaurant.email],
    [t("website"), restaurant.website],
    [t("cuisines"), restaurant.cuisines.map((c) => cuisines(c)).join(", ") || null],
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link
        href="/admin"
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{restaurant.name}</h1>
        <RestaurantStatusBadge status={restaurant.status} />
      </div>
      {restaurant.statusReason && (
        <p className="rounded-xl border p-4 text-sm">
          <span className="font-medium">{t("lastReason")}</span> {restaurant.statusReason}
        </p>
      )}
      <ReviewActions restaurantId={restaurant.id} status={restaurant.status} />

      {restaurant.description && <p className="text-muted-foreground">{restaurant.description}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-2" aria-labelledby="owners">
        <h2 id="owners" className="font-medium">
          {t("owners")}
        </h2>
        <ul className="text-sm">
          {owners.map((owner) => (
            <li key={owner.email}>
              {owner.name ? `${owner.name} · ` : ""}
              {owner.email}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="locations">
        <h2 id="locations" className="font-medium">
          {t("locations")}
        </h2>
        <ul className="flex flex-col divide-y rounded-xl border text-sm">
          {locations.map((location) => (
            <li key={location.id} className="p-3">
              <span className="font-medium">{location.name}</span> — {location.addressLine},{" "}
              {location.city}
              {location.phone ? ` · ${location.phone}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
