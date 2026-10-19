import { getTranslations } from "next-intl/server";

import { Check, ChevronRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { SetupProgress } from "@/server/services/restaurant-service";
import type { RestaurantStatus } from "@/shared/constants/restaurants";

const STEPS = ["account", "restaurant", "location", "menu", "tables", "review"] as const;
type Step = (typeof STEPS)[number];

/** True once there is nothing left for the guide to suggest. */
export function setupComplete(status: RestaurantStatus, progress: SetupProgress) {
  return status === "active" && progress.menuItems > 0 && progress.tables > 0;
}

/**
 * Onboarding guide for owners: account → restaurant → location → menu →
 * tables & QR → review. Without a restaurant yet, only the first steps apply.
 */
export async function SetupGuide({
  restaurant,
}: {
  restaurant?: { id: string; status: RestaurantStatus; progress: SetupProgress };
}) {
  const t = await getTranslations("Onboarding.guide");
  const base = restaurant ? `/dashboard/r/${restaurant.id}` : null;

  const done: Record<Step, boolean> = {
    account: true,
    restaurant: !!restaurant,
    location: (restaurant?.progress.locations ?? 0) > 0,
    menu: (restaurant?.progress.menuItems ?? 0) > 0,
    tables: (restaurant?.progress.tables ?? 0) > 0,
    review: !!restaurant && restaurant.status !== "draft",
  };
  const href: Partial<Record<Step, string>> = base
    ? { location: `${base}/locations`, menu: `${base}/menu`, tables: `${base}/tables` }
    : { restaurant: "/dashboard/new" };
  const current = STEPS.find((step) => !done[step]);
  const doneCount = STEPS.filter((step) => done[step]).length;

  return (
    <section
      aria-labelledby="setup-guide"
      className="flex flex-col gap-4 rounded-3xl bg-gradient-to-br from-emerald-50 to-amber-50 p-5 ring-1 ring-emerald-100 sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 id="setup-guide" className="text-lg font-semibold">
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <p className="text-sm font-medium text-emerald-800">
          {t("progress", { done: doneCount, total: STEPS.length })}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={t("title")}
        aria-valuemin={0}
        aria-valuemax={STEPS.length}
        aria-valuenow={doneCount}
        className="h-2 overflow-hidden rounded-full bg-white"
      >
        <div
          className="h-full rounded-full bg-emerald-600 transition-[width] duration-700"
          style={{ width: `${(doneCount / STEPS.length) * 100}%` }}
        />
      </div>
      <ol className="grid gap-2 sm:grid-cols-2">
        {STEPS.map((step, index) => {
          const isCurrent = step === current;
          const content = (
            <>
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                  done[step]
                    ? "bg-emerald-600 text-white"
                    : isCurrent
                      ? "bg-orange-700 text-white"
                      : "bg-white text-muted-foreground ring-1 ring-border",
                )}
              >
                {done[step] ? <Check className="size-4" aria-hidden /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-sm font-medium", done[step] && "text-muted-foreground")}>
                  {t(`steps.${step}.title`)}
                  <span className="sr-only">
                    {" "}
                    ({t(done[step] ? "done" : isCurrent ? "next" : "todo")})
                  </span>
                </span>
                {!done[step] && (
                  <span className="text-xs text-muted-foreground">{t(`steps.${step}.hint`)}</span>
                )}
              </span>
            </>
          );
          const link = href[step];
          return (
            <li
              key={step}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "rounded-2xl bg-white/80",
                isCurrent && "ring-2 ring-orange-300 motion-safe:animate-in motion-safe:fade-in",
              )}
            >
              {link && !done[step] ? (
                <Link
                  href={link}
                  className="flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-white"
                >
                  {content}
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              ) : (
                <div className="flex items-center gap-3 p-3">{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
