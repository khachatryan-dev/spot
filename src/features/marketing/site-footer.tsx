import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { Logo } from "./logo";

const COLUMNS = {
  guests: [
    ["findRestaurants", "/restaurants"],
    ["howItWorks", "/#guests"],
    ["faq", "/faq"],
  ],
  restaurants: [
    ["addRestaurant", "/register?for=restaurant"],
    ["features", "/#restaurants"],
    ["dashboardSignIn", "/login?for=restaurant"],
  ],
  company: [
    ["about", "/about"],
    ["contact", "/contact"],
    ["privacy", "/privacy"],
    ["terms", "/terms"],
  ],
} as const;

/** Footer of every public page: where guests, restaurants and everyone else go next. */
export async function SiteFooter() {
  const t = await getTranslations("Marketing.footer");
  const common = await getTranslations("Common");

  return (
    <footer className="border-t bg-muted/60">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <Logo name={common("appName")} />
          <p className="max-w-xs text-sm text-muted-foreground">{t("tagline")}</p>
        </div>
        {(Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).map((column) => (
          <nav key={column} aria-labelledby={`footer-${column}`} className="flex flex-col gap-3">
            <h2 id={`footer-${column}`} className="text-sm font-semibold">
              {t(`${column}.title`)}
            </h2>
            <ul className="flex flex-col gap-1 text-sm">
              {COLUMNS[column].map(([key, href]) => (
                <li key={key}>
                  <Link
                    href={href}
                    className="inline-block py-1 text-muted-foreground transition-colors hover:text-primary"
                  >
                    {t(`${column}.${key}` as never)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t">
        <p className="mx-auto w-full max-w-6xl px-4 py-4 text-xs text-muted-foreground">
          {t("rights", { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}
