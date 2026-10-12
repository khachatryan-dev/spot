import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { FieldSeparator } from "@/components/ui/field";

import { GoogleButton } from "./google-button";

/** Shared frame for sign-in / sign-up: title, optional Google button, form, footer link. */
export async function AuthCard({
  title,
  subtitle,
  googleEnabled,
  callbackURL,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  googleEnabled: boolean;
  callbackURL: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  const t = await getTranslations("Auth");
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {googleEnabled && (
        <>
          <GoogleButton callbackURL={callbackURL} />
          <FieldSeparator>{t("or")}</FieldSeparator>
        </>
      )}
      {children}
      <p className="text-center text-sm text-muted-foreground">{footer}</p>
    </div>
  );
}
