import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { NotificationBell } from "@/components/shared/notification-bell";
import { UserMenu } from "@/components/shared/user-menu";
import { Logo } from "@/features/marketing/logo";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requireUser } from "@/server/auth/guards";

/** Restaurant dashboard. Desktop-first, responsive (§35). Signed-in users only. */
export default async function RestaurantLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = await resolveLocale(params);
  const user = await guardPage(locale, requireUser);
  const common = await getTranslations("Common");

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="flex flex-col gap-6 border-b bg-sidebar p-4 md:sticky md:top-0 md:h-dvh md:w-60 md:border-r md:border-b-0 print:hidden">
        <div className="flex items-center justify-between">
          <Link href="/dashboard">
            <Logo name={common("appName")} />
          </Link>
          <div className="flex items-center gap-2">
            <NotificationBell userId={user.id} />
            <ThemeToggle />
            <LanguageSwitcher />
          </div>
        </div>
        <UserMenu name={user.name ?? user.email} className="md:mt-auto" />
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6 print:p-0">{children}</main>
    </div>
  );
}
