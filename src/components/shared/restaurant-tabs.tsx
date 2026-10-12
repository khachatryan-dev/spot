"use client";

import { Loader2 } from "lucide-react";
import { useLinkStatus } from "next/link";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export const RESTAURANT_TABS = [
  "overview",
  "orders",
  "reservations",
  "kitchen",
  "menu",
  "stock",
  "tables",
  "reviews",
  "stats",
  "profile",
  "locations",
  "staff",
] as const;
export type RestaurantTab = (typeof RESTAURANT_TABS)[number];

/** Spinner on the tab being opened (dashboard pages have no loading.tsx; see table/loading.tsx). */
function PendingHint() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 className="ml-1 inline size-3 animate-spin" aria-hidden /> : null;
}

/** Section tabs for one restaurant — only the ones this person's role can use. */
export function RestaurantTabs({
  restaurantId,
  visible,
}: {
  restaurantId: string;
  visible: RestaurantTab[];
}) {
  const t = useTranslations("RestaurantTabs");
  const pathname = usePathname();
  const base = `/dashboard/r/${restaurantId}`;
  const tabs = RESTAURANT_TABS.filter((tab) => visible.includes(tab)).map((tab) => ({
    href: tab === "overview" ? base : `${base}/${tab}`,
    label: t(tab),
  }));

  return (
    <nav aria-label={t("label")} className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => {
        // Overview matches exactly; other tabs also own their sub-pages.
        const active = tab.href === base ? pathname === base : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            <PendingHint />
          </Link>
        );
      })}
    </nav>
  );
}
