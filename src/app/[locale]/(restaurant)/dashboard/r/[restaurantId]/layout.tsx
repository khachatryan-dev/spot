import { RestaurantStatusBadge } from "@/components/shared/restaurant-status-badge";
import { type RestaurantTab, RestaurantTabs } from "@/components/shared/restaurant-tabs";
import { resolveLocale } from "@/i18n/locale";
import { guardPage, requireUser } from "@/server/auth/guards";
import { getRestaurantAccess } from "@/server/policies/restaurant-access";
import { getRestaurant } from "@/server/services/restaurant-service";
import { type RestaurantPermission, roleHasPermission } from "@/shared/auth/permissions";

/** The permission each tab needs; pages still authorize their own data. */
const TAB_PERMISSION: Record<RestaurantTab, RestaurantPermission> = {
  overview: "restaurant:read",
  orders: "order:read",
  reservations: "reservation:read",
  kitchen: "order:prepare",
  menu: "menu:read",
  stock: "menu:availability",
  tables: "table:read",
  reviews: "review:respond",
  stats: "analytics:read",
  profile: "restaurant:read",
  locations: "restaurant:read",
  staff: "staff:read",
};

/** Header and tabs for one restaurant. Pages still authorize their own data. */
export default async function RestaurantLayout({
  children,
  params,
}: LayoutProps<"/[locale]/dashboard/r/[restaurantId]">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const { restaurant, visibleTabs } = await guardPage(locale, async () => {
    const user = await requireUser();
    const restaurant = await getRestaurant(user, restaurantId);
    const access = await getRestaurantAccess(user.id, restaurantId);
    const visibleTabs = (Object.keys(TAB_PERMISSION) as RestaurantTab[]).filter(
      (tab) => !!access && roleHasPermission(access.role, TAB_PERMISSION[tab]),
    );
    return { restaurant, visibleTabs };
  });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-xl font-bold text-white uppercase shadow-sm shadow-orange-500/30"
          >
            {restaurant.name.trim().charAt(0)}
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-bold">{restaurant.name}</h1>
            <RestaurantStatusBadge status={restaurant.status} />
          </div>
        </div>
        <RestaurantTabs restaurantId={restaurant.id} visible={visibleTabs} />
      </div>
      {children}
    </div>
  );
}
