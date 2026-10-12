import { getTranslations } from "next-intl/server";

import { TablesManager } from "@/features/tables/tables-manager";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { guardPage, requireUser } from "@/server/auth/guards";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { listLocations } from "@/server/services/location-service";
import { qrSvgDataUri } from "@/server/qr/qr-image";
import { listLocationQr } from "@/server/services/qr-service";
import { listTables } from "@/server/services/table-service";
import { listActiveSessions } from "@/server/services/table-session-service";
import { roleHasPermission } from "@/shared/auth/permissions";
import { qrUrl } from "@/shared/utils/qr-url";

export default async function TablesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/tables">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const { location: requested } = await searchParams;
  const data = await guardPage(locale, async () => {
    const user = await requireUser();
    const access = await authorizeRestaurant(user.id, restaurantId, "table:read");
    const locations = (await listLocations(user, restaurantId)).filter(
      (l) => l.status === "active",
    );
    const location = locations.find((l) => l.id === requested) ?? locations[0];
    const tables = location ? await listTables(user, restaurantId, location.id) : [];
    const canManageQr =
      roleHasPermission(access.role, "qr:manage") && access.restaurantStatus !== "closed";
    const qrByTable = new Map<string, { url: string; image: string }>();
    if (location && canManageQr) {
      for (const row of await listLocationQr(user, restaurantId, location.id)) {
        if (row.token) {
          const url = qrUrl(row.token);
          qrByTable.set(row.tableId, { url, image: await qrSvgDataUri(url) });
        }
      }
    }
    const sessions = location ? await listActiveSessions(user, restaurantId, location.id) : [];
    const sessionByTable = new Map(sessions.map((s) => [s.tableId, s]));
    return {
      locations,
      location,
      tables,
      sessionByTable,
      canCloseSessions: roleHasPermission(access.role, "table_session:close"),
      canSeeBills: roleHasPermission(access.role, "bill:read"),
      qrByTable,
      canManageQr,
      canManage:
        roleHasPermission(access.role, "table:manage") && access.restaurantStatus !== "closed",
    };
  });
  const t = await getTranslations("Tables");

  if (!data.location) {
    return <p className="text-sm text-muted-foreground">{t("noLocation")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {data.locations.length > 1 && (
        <nav aria-label={t("locationPicker")} className="flex flex-wrap gap-2">
          {data.locations.map((l) => (
            <Link
              key={l.id}
              href={{ pathname: `/dashboard/r/${restaurantId}/tables`, query: { location: l.id } }}
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
      <TablesManager
        restaurantId={restaurantId}
        locationId={data.location.id}
        canManage={data.canManage}
        canManageQr={data.canManageQr}
        canCloseSessions={data.canCloseSessions}
        canSeeBills={data.canSeeBills}
        tables={data.tables.map(({ id, number, name, capacity, zone, type, status, isActive }) => ({
          qr: data.canManageQr ? (data.qrByTable.get(id) ?? null) : undefined,
          session: data.sessionByTable.get(id) ?? null,
          id,
          number,
          name,
          capacity,
          zone,
          type,
          status,
          isActive,
        }))}
      />
    </div>
  );
}
