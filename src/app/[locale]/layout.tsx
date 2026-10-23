import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Armenian } from "next/font/google";
import { headers } from "next/headers";
import { connection } from "next/server";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ThemeProvider } from "next-themes";

import { Toaster } from "@/components/ui/sonner";
import { resolveLocale } from "@/i18n/locale";
import { routing } from "@/i18n/routing";

import "../globals.css";
import { clientEnv } from "@/shared/config/env.client";
import { nonceFromCsp } from "@/shared/security/csp";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Geist has no Armenian glyphs; this font fills them in.
const notoArmenian = Noto_Sans_Armenian({
  variable: "--font-noto-armenian",
  subsets: ["armenian"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/** Browser and status-bar colour on phones (matches the brand, light and dark). */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfaf6" },
    { media: "(prefers-color-scheme: dark)", color: "#241a14" },
  ],
};

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return {
    title: t("title"),
    description: t("description"),
    // Absolute URLs for share previews and canonical links.
    metadataBase: new URL(clientEnv.NEXT_PUBLIC_APP_URL),
    // Added to an iPhone's home screen, Spot opens full-screen like an app.
    appleWebApp: { capable: true, title: "Spot", statusBarStyle: "default" },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  // Render per request: the CSP nonce (src/proxy.ts) only exists at request
  // time, and a page prerendered at build time would have its scripts blocked.
  await connection();
  const locale = await resolveLocale(params);
  // next-themes sets the theme class before paint with a small inline script.
  const nonce = nonceFromCsp((await headers()).get("content-security-policy"));

  return (
    <html
      lang={locale}
      // next-themes adds the theme class on the client.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoArmenian.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" enableSystem disableTransitionOnChange nonce={nonce}>
          <NextIntlClientProvider>
            {children}
            {/* Top: on phones, bottom toasts cover the action buttons. */}
            <Toaster position="top-center" />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
