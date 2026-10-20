import { BookOpen, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { CreateMenuForm } from "@/features/menu-editor/create-menu-form";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requireUser } from "@/server/auth/guards";
import { getRestaurantAccess } from "@/server/policies/restaurant-access";
import { listLocations } from "@/server/services/location-service";
import { listMenus } from "@/server/services/menu-service";
import { roleHasPermission } from "@/shared/auth/permissions";

export default async function MenusPage({
  params,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/menu">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const { menus, locations, canManage } = await guardPage(locale, async () => {
    const user = await requireUser();
    const [menus, locations, access] = await Promise.all([
      listMenus(user, restaurantId),
      listLocations(user, restaurantId),
      getRestaurantAccess(user.id, restaurantId),
    ]);
    return {
      menus,
      locations,
      canManage:
        !!access &&
        roleHasPermission(access.role, "menu:manage") &&
        access.restaurantStatus !== "closed",
    };
  });
  const t = await getTranslations("Menu");

  return (
    <div className="flex flex-col gap-6">
      {menus.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={t("emptyTitle")}
          action={
            canManage && (
              <div className="w-full max-w-md text-left">
                <CreateMenuForm
                  restaurantId={restaurantId}
                  locationIds={locations.filter((l) => l.status === "active").map((l) => l.id)}
                />
              </div>
            )
          }
        >
          {t("emptyDescription")}
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col divide-y rounded-xl border">
            {menus.map((menu) => (
              <li key={menu.id}>
                <Link
                  href={`/dashboard/r/${restaurantId}/menu/${menu.id}`}
                  className="flex items-center gap-3 p-4 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <span className="flex-1 font-medium">{menu.name}</span>
                  {!menu.isActive && <Badge variant="outline">{t("inactive")}</Badge>}
                  <span className="text-sm text-muted-foreground">
                    {t("locationCount", { count: menu.locationIds.length })}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {canManage && (
            <section className="flex flex-col gap-3 border-t pt-6" aria-labelledby="another-menu">
              <h2 id="another-menu" className="font-medium">
                {t("addAnother")}
              </h2>
              <CreateMenuForm restaurantId={restaurantId} locationIds={[]} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
