import { getTranslations } from "next-intl/server";

import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveLocale } from "@/i18n/locale";
import { getPathname, Link } from "@/i18n/navigation";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations("Marketing.home");

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
        {t("title")}
      </h1>
      <p className="max-w-xl text-lg text-pretty text-muted-foreground">{t("subtitle")}</p>
      <form
        action={getPathname({ href: "/restaurants", locale })}
        role="search"
        aria-label={t("searchLabel")}
        className="flex w-full max-w-lg gap-2"
      >
        <label htmlFor="home-q" className="sr-only">
          {t("searchLabel")}
        </label>
        <Input
          id="home-q"
          name="q"
          type="search"
          placeholder={t("searchPlaceholder")}
          className="h-10"
        />
        <Button type="submit" size="lg">
          <Search aria-hidden />
          {t("search")}
        </Button>
      </form>
      <Link href="/restaurants" className="text-sm font-medium underline-offset-4 hover:underline">
        {t("browse")}
      </Link>
      <Button
        variant="outline"
        className="h-auto max-w-full py-2 whitespace-normal"
        render={<Link href="/dashboard" />}
      >
        {t("ctaRestaurants")}
      </Button>
    </section>
  );
}
