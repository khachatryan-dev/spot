"use client";

import {
  BarChart3,
  CreditCard,
  Inbox,
  type LucideIcon,
  MessageSquareWarning,
  ScrollText,
  Store,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export const ADMIN_SECTIONS = [
  "restaurants",
  "stats",
  "users",
  "reviews",
  "messages",
  "payments",
  "audit",
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

const LINKS: Record<AdminSection, { href: string; Icon: LucideIcon }> = {
  restaurants: { href: "/admin", Icon: Store },
  stats: { href: "/admin/stats", Icon: BarChart3 },
  users: { href: "/admin/users", Icon: Users },
  reviews: { href: "/admin/reviews", Icon: MessageSquareWarning },
  messages: { href: "/admin/messages", Icon: Inbox },
  payments: { href: "/admin/payments", Icon: CreditCard },
  audit: { href: "/admin/audit", Icon: ScrollText },
};

/** Admin sections as pills; counts flag work waiting (reports, new messages). */
export function AdminNav({ counts }: { counts: Partial<Record<AdminSection, number>> }) {
  const t = useTranslations("Admin.nav");
  const pathname = usePathname();

  return (
    <ul className="order-last flex w-full [scrollbar-width:none] gap-1.5 overflow-x-auto py-2 whitespace-nowrap md:order-none md:w-auto md:py-0">
      {ADMIN_SECTIONS.map((section) => {
        const { href, Icon } = LINKS[section];
        // Restaurants (/admin) also owns /admin/restaurants/…
        const active =
          section === "restaurants"
            ? pathname === "/admin" || pathname.startsWith("/admin/restaurants")
            : pathname.startsWith(href);
        const count = counts[section] ?? 0;
        return (
          <li key={section}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active
                  ? "bg-primary text-primary-foreground shadow-sm shadow-orange-700/20"
                  : "text-secondary-foreground hover:bg-orange-100 dark:hover:bg-orange-900/40",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t(section)}
              {count > 0 && (
                <span className="ml-0.5 rounded-full bg-destructive px-1.5 text-xs text-white">
                  {count}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
