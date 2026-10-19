import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { NotificationBell } from "@/components/shared/notification-bell";
import { Logo } from "@/features/marketing/logo";
import { SiteFooter } from "@/features/marketing/site-footer";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getSession } from "@/server/auth/session";

/** Public pages: home, restaurants, about, contact, legal. Server-rendered for SEO (§39). */
export default async function MarketingLayout({ children, params }: LayoutProps<"/[locale]">) {
  await resolveLocale(params);
  const t = await getTranslations("Marketing");
  const common = await getTranslations("Common");
  const session = await getSession();

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-background/80">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/">
            <Logo name={common("appName")} compact />
          </Link>
          <nav className="flex items-center gap-3 whitespace-nowrap sm:gap-4">
            <Link href="/restaurants" className="text-sm font-medium hover:text-primary">
              {t("nav.restaurants")}
            </Link>
            {/* On phones the home page's own button covers this. */}
            <Link
              href="/login?for=restaurant"
              className="hidden text-sm text-muted-foreground hover:text-primary sm:inline"
            >
              {t("nav.forRestaurants")}
            </Link>
            {session ? (
              <>
                <NotificationBell userId={session.user.id} />
                <Link href="/account" className="text-sm font-medium">
                  {t("nav.account")}
                </Link>
              </>
            ) : (
              <Link href="/login" className="text-sm font-medium">
                {t("nav.signIn")}
              </Link>
            )}
            <LanguageSwitcher />
          </nav>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
      <SiteFooter />
    </div>
  );
}
