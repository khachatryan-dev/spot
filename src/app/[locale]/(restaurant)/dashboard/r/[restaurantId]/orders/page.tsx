import { ClipboardList } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/shared/empty-state";
import { LiveRefresh } from "@/features/ordering/live-refresh";
import { type BoardOrder, OrderBoard } from "@/features/order-board/order-board";
import { RequestsPanel } from "@/features/table-requests/requests-panel";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { guardPage, requireUser } from "@/server/auth/guards";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { RESTAURANT_PERMISSIONS, roleHasPermission } from "@/shared/auth/permissions";
import { listLocations } from "@/server/services/location-service";
import { listOrdersForStaff, type StaffOrder } from "@/server/services/order-service";
import { listOpenTableRequests } from "@/server/services/table-request-service";
import { formatMoney } from "@/shared/utils/money";
import { realtimeChannels } from "@/server/realtime/channels";
import { isRealtimeEnabled } from "@/server/realtime/realtime";

const toBoard = (o: StaffOrder): BoardOrder => ({ ...o, submittedAt: o.submittedAt.toISOString() });

export default async function OrdersPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/orders">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const { location: requested } = await searchParams;
  const data = await guardPage(locale, async () => {
    const user = await requireUser();
    const access = await authorizeRestaurant(user.id, restaurantId, "order:read");
    const permissions = RESTAURANT_PERMISSIONS.filter((p) => roleHasPermission(access.role, p));
    const locations = (await listLocations(user, restaurantId)).filter(
      (l) => l.status === "active",
    );
    const location = locations.find((l) => l.id === requested) ?? locations[0];
    if (!location)
      return { locations, location, permissions, open: [], finished: [], requests: [] };
    const [open, finished] = await Promise.all([
      listOrdersForStaff(user, restaurantId, location.id),
      listOrdersForStaff(user, restaurantId, location.id, {
        finished: true,
        limit: 50,
      }),
    ]);
    const requests = permissions.includes("table_request:respond")
      ? await listOpenTableRequests(user, restaurantId, location.id)
      : [];
    return { locations, location, permissions, open, finished, requests };
  });
  const t = await getTranslations("OrderBoard");
  const format = await getFormatter();

  if (!data.location) return <p className="text-sm text-muted-foreground">{t("noLocation")}</p>;

  return (
    <div className="flex flex-col gap-6">
      {data.locations.length > 1 && (
        <nav aria-label={t("locationPicker")} className="flex flex-wrap gap-2">
          {data.locations.map((l) => (
            <Link
              key={l.id}
              href={{ pathname: `/dashboard/r/${restaurantId}/orders`, query: { location: l.id } }}
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
      )}
      <RequestsPanel
        restaurantId={restaurantId}
        requests={data.requests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
      />
      {data.open.length === 0 && <EmptyState icon={ClipboardList}>{t("empty")}</EmptyState>}
      <OrderBoard
        orders={data.open.map(toBoard)}
        restaurantId={restaurantId}
        permissions={data.permissions}
      />
      {data.finished.length > 0 && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {t("finished", { count: data.finished.length })}
          </summary>
          <ul className="mt-3 flex flex-col divide-y text-sm">
            {data.finished.map((o) => (
              <li key={o.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  #{o.number} · {t("table", { table: o.tableNumber })} ·{" "}
                  {format.dateTime(o.submittedAt, { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-muted-foreground">
                  {t(`status.${o.status}`)} · {formatMoney(o.totalMinor, o.currency, locale)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <LiveRefresh
        channel={realtimeChannels.location(restaurantId, data.location.id)}
        enabled={isRealtimeEnabled()}
        fallbackSeconds={10}
      />
    </div>
  );
}
