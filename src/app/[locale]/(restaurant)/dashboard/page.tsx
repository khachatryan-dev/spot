import { ChevronRight, Plus, Store } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { RestaurantStatusBadge } from "@/components/shared/restaurant-status-badge";
import { SetupGuide } from "@/features/restaurant-onboarding/setup-guide";
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
      <div className="flex max-w-3xl flex-col gap-6">
        <div className="flex flex-col items-center gap-4 rounded-3xl bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 p-8 text-center ring-1 ring-orange-100 sm:p-10">
          <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-lg shadow-orange-500/20 motion-safe:animate-in motion-safe:zoom-in-90">
            <Store className="size-7" aria-hidden />
          </span>
          <h1 className="text-2xl font-bold">{t("emptyTitle")}</h1>
          <p className="max-w-md text-muted-foreground">{t("emptyDescription")}</p>
          <Button
            size="lg"
            className="h-10 rounded-xl px-5"
            render={<Link href="/dashboard/new" />}
          >
            <Plus aria-hidden />
            {t("create")}
          </Button>
        </div>
        <SetupGuide />
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
