import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { NotificationBell } from "@/components/shared/notification-bell";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { AppTabBar } from "@/features/customer-app/app-tab-bar";
import { AppTopBar } from "@/features/customer-app/app-top-bar";
import { Logo } from "@/features/marketing/logo";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getSession } from "@/server/auth/session";

/**
 * The customer app (§35): mobile-first, like a banking app — a slim top bar
 * and a bottom bar with Scan in the middle. At the table both bars step aside
 * for the menu's own header and cart bar.
 */
export default async function CustomerLayout({ children, params }: LayoutProps<"/[locale]">) {
  await resolveLocale(params);
  const session = await getSession();
  const common = await getTranslations("Common");

  return (
    <div className="flex flex-1 flex-col bg-muted/40">
      <AppTopBar>
        <Link href="/home">
          <Logo name={common("appName")} />
        </Link>
        <div className="flex items-center gap-1">
          {session && <NotificationBell userId={session.user.id} />}
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </AppTopBar>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">{children}</div>
      <AppTabBar />
    </div>
  );
}
