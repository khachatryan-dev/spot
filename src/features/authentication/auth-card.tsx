import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { CalendarCheck, ChefHat, QrCode, Store, UtensilsCrossed, Wallet } from "lucide-react";

import { FieldSeparator } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import type { AuthAudience } from "./audience";
import { GoogleButton } from "./google-button";

const POINTS = {
  guest: [
    ["find", UtensilsCrossed],
    ["order", QrCode],
    ["pay", Wallet],
  ],
  restaurant: [
    ["menu", QrCode],
    ["kitchen", ChefHat],
    ["bookings", CalendarCheck],
  ],
} as const;

/**
 * Shared frame for sign-in / sign-up: a coloured panel saying who the page
 * is for (guests in orange, restaurants in green), then the form.
 */
export async function AuthCard({
  audience = "guest",
  title,
  subtitle,
  googleEnabled,
  callbackURL,
  footer,
  switchAudience,
  children,
}: {
  audience?: AuthAudience;
  title: string;
  subtitle: string;
  googleEnabled: boolean;
  callbackURL: string;
  footer: ReactNode;
  /** "Not a restaurant? Continue as a guest" and the reverse. */
  switchAudience?: ReactNode;
  children: ReactNode;
}) {
  const t = await getTranslations("Auth");
  const restaurant = audience === "restaurant";
  const Icon = restaurant ? Store : UtensilsCrossed;

  return (
    <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border bg-card shadow-xl shadow-orange-900/5 lg:grid-cols-2">
      <aside
        className={cn(
          "relative isolate hidden flex-col justify-between gap-8 overflow-hidden p-10 text-white lg:flex",
          restaurant
            ? "bg-gradient-to-br from-emerald-700 to-teal-800"
            : "bg-gradient-to-br from-orange-700 to-rose-600",
        )}
      >
        <div
          aria-hidden
          className="absolute -right-16 -bottom-16 -z-10 size-64 rounded-full bg-white/10 blur-2xl"
        />
        <div className="flex flex-col gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-white/15">
            <Icon className="size-6" aria-hidden />
          </span>
          <p className="text-2xl font-bold">{t(`panel.${audience}.title`)}</p>
        </div>
        <ul className="flex flex-col gap-4">
          {POINTS[audience].map(([key, PointIcon]) => (
            <li key={key} className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/15">
                <PointIcon className="size-4" aria-hidden />
              </span>
              <span>{t(`panel.${audience}.${key}` as never)}</span>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex flex-col gap-6 p-6 sm:p-10">
        <div className="flex flex-col items-center gap-2 text-center">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
              restaurant
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {t(`audience.${audience}`)}
          </span>
          <h1 className="text-2xl font-bold">{title}</h1>
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
        {switchAudience && (
          <p className="border-t pt-4 text-center text-sm text-muted-foreground">
            {switchAudience}
          </p>
        )}
      </div>
    </div>
  );
}
