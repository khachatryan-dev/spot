import { ChevronRight } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { RestaurantStatusBadge } from "@/components/shared/restaurant-status-badge";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { guardPage, requirePlatformPermission } from "@/server/auth/guards";
import { listRestaurantsForAdmin } from "@/server/services/admin-restaurant-service";
import { RESTAURANT_STATUSES, type RestaurantStatus } from "@/shared/constants/restaurants";

const FILTERS: RestaurantStatus[] = ["pending_review", "active", "suspended", "draft"];

export default async function AdminRestaurantsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin">) {
  const locale = await resolveLocale(params);
  const { status: raw } = await searchParams;
  const status = RESTAURANT_STATUSES.find((s) => s === raw) ?? "pending_review";
  const restaurants = await guardPage(locale, async () =>
    listRestaurantsForAdmin(await requirePlatformPermission("platform:restaurants:review"), status),
  );
  const t = await getTranslations("Admin.restaurants");
  const statuses = await getTranslations("RestaurantStatus");
  const format = await getFormatter();

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <nav aria-label={t("filter")} className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Link
            key={filter}
            href={{ pathname: "/admin", query: { status: filter } }}
            aria-current={filter === status ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              filter === status
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            {statuses(filter)}
          </Link>
        ))}
      </nav>
      {restaurants.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {restaurants.map((restaurant) => (
            <li key={restaurant.id}>
              <Link
                href={`/admin/restaurants/${restaurant.id}`}
                className="flex items-center gap-4 p-4 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <div className="flex flex-1 flex-col">
                  <span className="font-medium">{restaurant.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {restaurant.submittedAt
                      ? t("submitted", {
                          date: format.dateTime(restaurant.submittedAt, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }),
                        })
                      : t("created", {
                          date: format.dateTime(restaurant.createdAt, { dateStyle: "medium" }),
                        })}
                  </span>
                </div>
                <RestaurantStatusBadge status={restaurant.status} />
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
