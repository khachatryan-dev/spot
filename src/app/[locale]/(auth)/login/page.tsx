import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthCard } from "@/features/authentication/auth-card";
import { redirectTarget } from "@/features/authentication/redirect-target";
import { SignInForm } from "@/features/authentication/sign-in-form";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { isGoogleEnabled } from "@/server/auth/auth";
import { getSession } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.signIn");
  return { title: t("title"), robots: { index: false } };
}

export default async function LoginPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  const locale = await resolveLocale(params);
  const { next } = await searchParams;
  const target = redirectTarget(next, locale);

  if (await getSession()) redirect(target);

  const t = await getTranslations("Auth.signIn");
  return (
    <AuthCard
      title={t("title")}
      subtitle={t("subtitle")}
      googleEnabled={isGoogleEnabled}
      callbackURL={target}
      footer={
        <>
          {t("noAccount")}{" "}
          <Link
            href={{ pathname: "/register", query: typeof next === "string" ? { next } : {} }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("registerLink")}
          </Link>
        </>
      }
    >
      <SignInForm redirectTo={target} />
    </AuthCard>
  );
}
