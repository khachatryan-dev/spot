import { getTranslations } from "next-intl/server";

import { KitchenBoard } from "@/features/order-board/kitchen-board";
import { LiveRefresh } from "@/features/ordering/live-refresh";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { guardPage, requireUser } from "@/server/auth/guards";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { listLocations } from "@/server/services/location-service";
import { type KitchenOrder, listKitchenOrders } from "@/server/services/order-service";
import { RESTAURANT_PERMISSIONS, roleHasPermission } from "@/shared/auth/permissions";
import { realtimeChannels } from "@/server/realtime/channels";
import { isRealtimeEnabled } from "@/server/realtime/realtime";

const toCard = (o: KitchenOrder) => ({ ...o, submittedAt: o.submittedAt.toISOString() });

/** Kitchen screen: what to cook, oldest first, no prices or guest details (§17). */
export default async function KitchenPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/kitchen">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const { location: requested } = await searchParams;
  const data = await guardPage(locale, async () => {
    const user = await requireUser();
    const access = await authorizeRestaurant(user.id, restaurantId, "order:prepare");
    const permissions = RESTAURANT_PERMISSIONS.filter((p) => roleHasPermission(access.role, p));
    const locations = (await listLocations(user, restaurantId)).filter(
      (l) => l.status === "active",
    );
    const location = locations.find((l) => l.id === requested) ?? locations[0];
    const orders = location
      ? await listKitchenOrders(user, restaurantId, location.id)
      : { queue: [], ready: [] };
    return { locations, location, orders, permissions };
  });
  const t = await getTranslations("Kitchen");

  if (!data.location) return <p className="text-sm text-muted-foreground">{t("noLocation")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {data.locations.length > 1 ? (
          <nav aria-label={t("locationPicker")} className="flex flex-wrap gap-2">
            {data.locations.map((l) => (
              <Link
                key={l.id}
                href={{
                  pathname: `/dashboard/r/${restaurantId}/kitchen`,
                  query: { location: l.id },
                }}
                aria-current={l.id === data.location!.id ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm",
                  l.id === data.location!.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                )}
              >
                {l.name}
              </Link>
            ))}
          </nav>
        ) : (
          <span />
        )}
        {data.permissions.includes("menu:availability") && (
          <Link
            href={`/dashboard/r/${restaurantId}/stock`}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {t("stockLink")}
          </Link>
        )}
      </div>
      <KitchenBoard
        restaurantId={restaurantId}
        queue={data.orders.queue.map(toCard)}
        ready={data.orders.ready.map(toCard)}
        permissions={data.permissions}
      />
      <LiveRefresh
        channel={realtimeChannels.location(restaurantId, data.location.id)}
        enabled={isRealtimeEnabled()}
        fallbackSeconds={10}
      />
    </div>
  );
}
