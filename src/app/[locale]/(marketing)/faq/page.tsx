import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ChevronDown, Store, UtensilsCrossed } from "lucide-react";

import { PageHero } from "@/features/marketing/page-hero";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";

const GROUPS = {
  guests: ["account", "qr", "pay", "split", "reserve", "review"],
  restaurants: ["cost", "start", "pos", "staff", "payouts", "languages"],
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Faq");
  return { title: t("title"), description: t("subtitle") };
}

export default async function FaqPage({ params }: PageProps<"/[locale]/faq">) {
  await resolveLocale(params);
  const t = await getTranslations("Faq");

  return (
    <>
      <PageHero title={t("title")} subtitle={t("subtitle")} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 pb-16">
        {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((group) => {
          const Icon = group === "guests" ? UtensilsCrossed : Store;
          return (
            <section key={group} aria-labelledby={`faq-${group}`} className="flex flex-col gap-4">
              <h2 id={`faq-${group}`} className="flex items-center gap-3 text-2xl font-bold">
                <span
                  className={`grid size-10 place-items-center rounded-2xl ${
                    group === "guests"
                      ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                  }`}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                {t(`${group}.title`)}
              </h2>
              <div className="flex flex-col gap-3">
                {GROUPS[group].map((key) => (
                  <details
                    key={key}
                    className="group rounded-2xl border bg-card p-4 shadow-sm open:shadow-md"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                      {t(`${group}.items.${key}.q` as never)}
                      <ChevronDown
                        className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                        aria-hidden
                      />
                    </summary>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {t(`${group}.items.${key}.a` as never)}
                    </p>
                  </details>
                ))}
              </div>
            </section>
          );
        })}
        <p className="text-center text-muted-foreground">
          {t.rich("more", {
            link: (chunks) => (
              <Link href="/contact" className="font-medium text-primary hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </>
  );
}
