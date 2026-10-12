import { ChevronRight, Plus, Store } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { RestaurantStatusBadge } from "@/components/shared/restaurant-status-badge";
import { Button } from "@/components/ui/button";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requireUser } from "@/server/auth/guards";
import { listMyRestaurants } from "@/server/services/restaurant-service";

export default async function DashboardPage({ params }: PageProps<"/[locale]/dashboard">) {
  const locale = await resolveLocale(params);
  const user = await guardPage(locale, requireUser);
  const restaurants = await listMyRestaurants(user);
  const t = await getTranslations("Onboarding.dashboard");

  if (restaurants.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border border-dashed p-10 text-center">
        <Store className="size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">{t("emptyTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("emptyDescription")}</p>
        <Button render={<Link href="/dashboard/new" />}>
          <Plus aria-hidden />
          {t("create")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button variant="outline" size="sm" render={<Link href="/dashboard/new" />}>
          <Plus aria-hidden />
          {t("create")}
        </Button>
      </div>
      <ul className="flex flex-col divide-y rounded-xl border">
        {restaurants.map(({ restaurant, role }) => (
          <li key={restaurant.id}>
            <Link
              href={`/dashboard/r/${restaurant.id}`}
              className="flex items-center gap-4 p-4 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            >
              <div className="flex flex-1 flex-col gap-1">
                <span className="font-medium">{restaurant.name}</span>
                <span className="text-sm text-muted-foreground">{t(`roles.${role}`)}</span>
              </div>
              <RestaurantStatusBadge status={restaurant.status} />
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
