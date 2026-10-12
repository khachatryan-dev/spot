import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { UserMenu } from "@/components/shared/user-menu";
import { Button } from "@/components/ui/button";
import { AcceptInvitationButton } from "@/features/restaurant-staff/accept-invitation-button";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getSession } from "@/server/auth/session";
import { previewInvitation } from "@/server/services/staff-service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Staff.accept");
  // The token is in the URL: never index it or leak it via Referer.
  return { title: t("title"), robots: { index: false }, referrer: "no-referrer" };
}

export default async function InvitePage({ params }: PageProps<"/[locale]/invite/[token]">) {
  await resolveLocale(params);
  const { token } = await params;
  const [invitation, session] = await Promise.all([previewInvitation(token), getSession()]);
  const t = await getTranslations("Staff.accept");
  const roles = await getTranslations("Onboarding.dashboard.roles");
  const next = `/invite/${token}`;

  return (
    <div className="flex w-full max-w-sm flex-col gap-6 text-center">
      {invitation.status === "invalid" ? (
        <>
          <h1 className="text-2xl font-semibold">{t("invalidTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("invalidDescription")}</p>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold">{t("title")}</h1>
            <p className="text-muted-foreground">
              {t("description", {
                restaurant: invitation.restaurantName,
                role: roles(invitation.role),
              })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("forEmail", { email: invitation.email })}
            </p>
          </div>
          {!session ? (
            <div className="flex flex-col gap-2">
              <Button render={<Link href={{ pathname: "/register", query: { next } }} />}>
                {t("register")}
              </Button>
              <Button
                variant="outline"
                render={<Link href={{ pathname: "/login", query: { next } }} />}
              >
                {t("signIn")}
              </Button>
            </div>
          ) : session.user.email !== invitation.email ? (
            <div className="flex flex-col gap-3 rounded-xl border p-4 text-sm">
              <p>{t("wrongAccount", { email: session.user.email })}</p>
              <UserMenu name={session.user.email} className="justify-center" />
            </div>
          ) : (
            <AcceptInvitationButton token={token} />
          )}
        </>
      )}
    </div>
  );
}
