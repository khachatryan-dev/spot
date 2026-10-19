import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthCard } from "@/features/authentication/auth-card";
import { audienceQuery, audienceTarget, authAudience } from "@/features/authentication/audience";
import { SignUpForm } from "@/features/authentication/sign-up-form";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { isGoogleEnabled } from "@/server/auth/auth";
import { getSession } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.signUp");
  return { title: t("title"), robots: { index: false } };
}

export default async function RegisterPage({
  params,
  searchParams,
}: PageProps<"/[locale]/register">) {
  const locale = await resolveLocale(params);
  const { next, for: audienceParam } = await searchParams;
  const audience = authAudience(audienceParam);
  const target = audienceTarget(next, audience, "register", locale);

  if (await getSession()) redirect(target);

  const t = await getTranslations("Auth.signUp");
  const auth = await getTranslations("Auth");
  const restaurant = audience === "restaurant";
  return (
    <AuthCard
      audience={audience}
      title={restaurant ? auth("restaurant.signUp.title") : t("title")}
      subtitle={restaurant ? auth("restaurant.signUp.subtitle") : t("subtitle")}
      googleEnabled={isGoogleEnabled}
      callbackURL={target}
      footer={
        <>
          {t("haveAccount")}{" "}
          <Link
            href={{ pathname: "/login", query: audienceQuery(next, audience) }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("signInLink")}
          </Link>
        </>
      }
      switchAudience={auth.rich(restaurant ? "switch.toGuest" : "switch.toRestaurant", {
        link: (chunks) => (
          <Link
            href={{
              pathname: "/register",
              query: audienceQuery(next, restaurant ? "guest" : "restaurant"),
            }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {chunks}
          </Link>
        ),
      })}
    >
      <SignUpForm redirectTo={target} />
    </AuthCard>
  );
}
