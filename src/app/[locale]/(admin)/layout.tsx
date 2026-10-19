import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { UserMenu } from "@/components/shared/user-menu";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requirePlatformPermission } from "@/server/auth/guards";
import { countOpenReports } from "@/server/services/admin-review-service";
import { countNewContactMessages } from "@/server/services/contact-service";

const SECTIONS = [
  "restaurants",
  "stats",
  "users",
  "reviews",
  "messages",
  "payments",
  "audit",
] as const;
const LINKS: Partial<Record<(typeof SECTIONS)[number], string>> = {
  restaurants: "/admin",
  audit: "/admin/audit",
  reviews: "/admin/reviews",
  messages: "/admin/messages",
  users: "/admin/users",
  payments: "/admin/payments",
  stats: "/admin/stats",
};

/** Platform admin. Everyone else gets a 404. */
export default async function AdminLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = await resolveLocale(params);
  const user = await guardPage(locale, () => requirePlatformPermission("platform:admin:access"));
  const t = await getTranslations("Admin.nav");
  const common = await getTranslations("Common");
  const [openReports, newMessages] = await Promise.all([
    countOpenReports(),
    countNewContactMessages(),
  ]);
  const counts: Partial<Record<(typeof SECTIONS)[number], number>> = {
    reviews: openReports,
    messages: newMessages,
  };

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-muted/40">
        <div className="flex flex-wrap items-center justify-between gap-x-4 px-6 py-3 md:h-14 md:py-0">
          <Link href="/admin" className="font-semibold">
            {common("appName")} · Admin
          </Link>
          {/* On phones the sections sit on their own scrollable row. */}
          <ul className="order-last flex w-full gap-4 overflow-x-auto py-2 whitespace-nowrap md:order-none md:w-auto md:py-0">
            {SECTIONS.map((section) => {
              const href = LINKS[section];
              return href ? (
                <li key={section}>
                  <Link href={href} className="text-sm font-medium hover:underline">
                    {t(section)}
                    {(counts[section] ?? 0) > 0 && (
                      <span className="ml-1 rounded-full bg-destructive px-1.5 text-xs text-white">
                        {counts[section]}
                      </span>
                    )}
                  </Link>
                </li>
              ) : (
                <li key={section} className="text-sm text-muted-foreground">
                  {t(section)}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <UserMenu name={user.name ?? user.email} />
          </div>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
