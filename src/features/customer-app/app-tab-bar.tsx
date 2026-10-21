"use client";

import { CalendarDays, Compass, House, type LucideIcon, QrCode, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const TABS: { key: "home" | "explore" | "bookings" | "profile"; href: string; Icon: LucideIcon }[] =
  [
    { key: "home", href: "/home", Icon: House },
    { key: "explore", href: "/restaurants", Icon: Compass },
    { key: "bookings", href: "/reservations", Icon: CalendarDays },
    { key: "profile", href: "/account", Icon: UserRound },
  ];

/** Where the bar is hidden: the table has its own cart bar at the bottom. */
export const hideAppBars = (pathname: string) =>
  pathname === "/table" || pathname.startsWith("/table/");

/**
 * The customer app's bottom bar: Home · Explore · Scan · Bookings · Profile,
 * with Scan as the big round button in the middle (like a banking app's pay button).
 */
export function AppTabBar({
  className,
  onlyUnder,
}: {
  className?: string;
  /** Show only on these paths and below (public pages share the bar with signed-in users). */
  onlyUnder?: string[];
}) {
  const t = useTranslations("CustomerApp.tabs");
  const pathname = usePathname();
  if (hideAppBars(pathname)) return null;
  if (onlyUnder && !onlyUnder.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  const tab = ({ key, href, Icon }: (typeof TABS)[number]) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <li key={key}>
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            active ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className={cn("size-6", active && "fill-primary/15")} aria-hidden />
          {t(key)}
        </Link>
      </li>
    );
  };

  return (
    <>
      {/* Keeps the last content above the bar. */}
      <div aria-hidden className="h-24" />
      <nav
        aria-label={t("label")}
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur",
          className,
        )}
      >
        <ul className="mx-auto grid max-w-md grid-cols-5 items-end px-2">
          {TABS.slice(0, 2).map(tab)}
          <li>
            <Link
              href="/scan"
              aria-current={pathname === "/scan" ? "page" : undefined}
              className="flex flex-col items-center gap-0.5 pb-2 text-[11px] font-semibold text-primary focus-visible:outline-none"
            >
              <span className="-mt-6 grid size-16 place-items-center rounded-full bg-gradient-to-br from-orange-600 to-rose-600 text-white shadow-lg ring-4 shadow-orange-600/30 ring-background transition-transform active:scale-95">
                <QrCode className="size-7" aria-hidden />
              </span>
              {t("scan")}
            </Link>
          </li>
          {TABS.slice(2).map(tab)}
        </ul>
      </nav>
    </>
  );
}
