import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { UserMenu } from "@/components/shared/user-menu";
import { AdminNav } from "@/features/admin/admin-nav";
import { Logo } from "@/features/marketing/logo";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requirePlatformPermission } from "@/server/auth/guards";
import { countOpenReports } from "@/server/services/admin-review-service";
import { countNewContactMessages } from "@/server/services/contact-service";

/** Platform admin. Everyone else gets a 404. */
export default async function AdminLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = await resolveLocale(params);
  const user = await guardPage(locale, () => requirePlatformPermission("platform:admin:access"));
  const common = await getTranslations("Common");
  const [openReports, newMessages] = await Promise.all([
    countOpenReports(),
    countNewContactMessages(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-sidebar">
        <div className="flex flex-wrap items-center justify-between gap-x-4 px-4 py-3 sm:px-6 md:h-16 md:py-0">
          <Link href="/admin" className="flex items-center gap-2">
            <Logo name={common("appName")} compact />
            <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background">
              Admin
            </span>
          </Link>
          {/* On phones the sections sit on their own scrollable row. */}
          <AdminNav counts={{ reviews: openReports, messages: newMessages }} />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageSwitcher />
            <UserMenu name={user.name ?? user.email} />
          </div>
        </div>
      </header>
      <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
