import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ArrowRight, HandHeart, MapPin, Sparkles, Store, UtensilsCrossed } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHero } from "@/features/marketing/page-hero";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";

const VALUES = [
  ["simple", Sparkles, "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300"],
  ["local", MapPin, "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300"],
  ["fair", HandHeart, "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300"],
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("About");
  return { title: t("title"), description: t("subtitle") };
}

export default async function AboutPage({ params }: PageProps<"/[locale]/about">) {
  await resolveLocale(params);
  const t = await getTranslations("About");

  return (
    <>
      <PageHero eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 pb-16">
        <section
          aria-labelledby="story-title"
          className="reveal mx-auto flex max-w-2xl flex-col gap-4"
        >
          <h2 id="story-title" className="text-2xl font-bold tracking-tight">
            {t("story.title")}
          </h2>
          <p className="leading-relaxed text-muted-foreground">{t("story.p1")}</p>
          <p className="leading-relaxed text-muted-foreground">{t("story.p2")}</p>
        </section>

        <section aria-labelledby="values-title" className="flex flex-col gap-6">
          <h2 id="values-title" className="text-center text-2xl font-bold tracking-tight">
            {t("values.title")}
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {VALUES.map(([key, Icon, colors]) => (
              <li
                key={key}
                className="reveal flex flex-col gap-3 rounded-3xl border bg-card p-6 shadow-sm"
              >
                <span className={`grid size-12 place-items-center rounded-2xl ${colors}`}>
                  <Icon className="size-6" aria-hidden />
                </span>
                <h3 className="text-lg font-semibold">{t(`values.${key}.title`)}</h3>
                <p className="text-sm text-muted-foreground">{t(`values.${key}.text`)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="who-title" className="flex flex-col gap-6">
          <h2 id="who-title" className="text-center text-2xl font-bold tracking-tight">
            {t("who.title")}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="reveal flex flex-col gap-3 rounded-3xl bg-orange-50 p-6 ring-1 ring-orange-100 dark:bg-orange-950/40 dark:ring-orange-900/50">
              <UtensilsCrossed
                className="size-7 text-orange-700 dark:text-orange-300"
                aria-hidden
              />
              <h3 className="text-lg font-semibold">{t("who.guests.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("who.guests.text")}</p>
              <Link
                href="/restaurants"
                className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-orange-800 hover:underline dark:text-orange-300"
              >
                {t("who.guests.cta")}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <div className="reveal flex flex-col gap-3 rounded-3xl bg-emerald-50 p-6 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:ring-emerald-900/50">
              <Store className="size-7 text-emerald-800 dark:text-emerald-300" aria-hidden />
              <h3 className="text-lg font-semibold">{t("who.restaurants.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("who.restaurants.text")}</p>
              <Link
                href="/register?for=restaurant"
                className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-emerald-800 hover:underline dark:text-emerald-300"
              >
                {t("who.restaurants.cta")}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        <section className="reveal flex flex-col items-center gap-4 rounded-3xl bg-gradient-to-br from-amber-100 via-orange-100 to-rose-100 px-6 py-10 text-center dark:from-amber-900/40 dark:via-orange-900/40 dark:to-rose-900/40">
          <h2 className="text-2xl font-bold tracking-tight">{t("cta.title")}</h2>
          <p className="max-w-md text-muted-foreground">{t("cta.text")}</p>
          <Button size="lg" className="h-10 rounded-xl px-5" render={<Link href="/contact" />}>
            {t("cta.button")}
          </Button>
        </section>
      </div>
    </>
  );
}
