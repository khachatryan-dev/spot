import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { Logo } from "@/features/marketing/logo";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";

/** Sign-in / sign-up pages: minimal, centered, mobile-first. */
export default async function AuthLayout({ children, params }: LayoutProps<"/[locale]">) {
  await resolveLocale(params);
  const common = await getTranslations("Common");

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-orange-50/70 via-background to-background">
      <header className="flex h-14 items-center justify-between px-4">
        <Link href="/">
          <Logo name={common("appName")} />
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-4 pb-16 sm:items-center sm:pt-0">
        {children}
      </main>
    </div>
  );
}
