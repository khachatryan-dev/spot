"use client";

import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChefHat,
  ClipboardList,
  LayoutDashboard,
  Loader2,
  type LucideIcon,
  MapPin,
  MessageSquareHeart,
  Package,
  QrCode,
  Store,
  Users,
} from "lucide-react";
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

const ICONS: Record<RestaurantTab, LucideIcon> = {
  overview: LayoutDashboard,
  orders: ClipboardList,
  reservations: CalendarDays,
  kitchen: ChefHat,
  menu: BookOpen,
  stock: Package,
  tables: QrCode,
  reviews: MessageSquareHeart,
  stats: BarChart3,
  profile: Store,
  locations: MapPin,
  staff: Users,
};

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
    Icon: ICONS[tab],
  }));

  return (
    <nav
      aria-label={t("label")}
      className="-mx-4 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      {tabs.map((tab) => {
        // Overview matches exactly; other tabs also own their sub-pages.
        const active = tab.href === base ? pathname === base : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active
                ? "bg-primary font-medium text-primary-foreground shadow-sm shadow-orange-700/20"
                : "bg-secondary/70 text-secondary-foreground hover:bg-orange-100 dark:hover:bg-orange-900/40",
            )}
          >
            <tab.Icon className="size-4" aria-hidden />
            {tab.label}
            <PendingHint />
          </Link>
        );
      })}
    </nav>
  );
}
