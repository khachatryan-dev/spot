import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthCard } from "@/features/authentication/auth-card";
import { audienceQuery, audienceTarget, authAudience } from "@/features/authentication/audience";
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
  const { next, for: audienceParam } = await searchParams;
  const audience = authAudience(audienceParam);
  const target = audienceTarget(next, audience, "login", locale);

  if (await getSession()) redirect(target);

  const t = await getTranslations("Auth.signIn");
  const auth = await getTranslations("Auth");
  const restaurant = audience === "restaurant";
  return (
    <AuthCard
      audience={audience}
      title={restaurant ? auth("restaurant.signIn.title") : t("title")}
      subtitle={restaurant ? auth("restaurant.signIn.subtitle") : t("subtitle")}
      googleEnabled={isGoogleEnabled}
      callbackURL={target}
      footer={
        <>
          {t("noAccount")}{" "}
          <Link
            href={{ pathname: "/register", query: audienceQuery(next, audience) }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("registerLink")}
          </Link>
        </>
      }
      switchAudience={auth.rich(restaurant ? "switch.toGuest" : "switch.toRestaurant", {
        link: (chunks) => (
          <Link
            href={{
              pathname: "/login",
              query: audienceQuery(next, restaurant ? "guest" : "restaurant"),
            }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {chunks}
          </Link>
        ),
      })}
    >
      <SignInForm redirectTo={target} />
    </AuthCard>
  );
}
