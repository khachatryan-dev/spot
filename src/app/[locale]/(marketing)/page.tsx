import { getTranslations } from "next-intl/server";

import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  ChefHat,
  Coffee,
  CookingPot,
  CreditCard,
  IceCreamCone,
  MessageSquareHeart,
  Pizza,
  QrCode,
  Salad,
  Search,
  ShoppingBag,
  Store,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveLocale } from "@/i18n/locale";
import { getPathname, Link } from "@/i18n/navigation";

const GUEST_STEPS = [
  ["find", Search],
  ["book", CalendarCheck],
  ["scan", QrCode],
  ["pay", Wallet],
] as const;

const RESTAURANT_FEATURES = [
  ["qrMenu", QrCode],
  ["orders", ShoppingBag],
  ["kitchen", ChefHat],
  ["reservations", CalendarCheck],
  ["bills", CreditCard],
  ["insights", BarChart3],
] as const;

/** Food icons drifting around the hero (decorative). */
const FLOATING = [
  {
    Icon: Pizza,
    className:
      "top-10 left-[6%] bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400",
    delay: "0s",
  },
  {
    Icon: Coffee,
    className:
      "top-28 right-[8%] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    delay: "1.2s",
  },
  {
    Icon: Salad,
    className:
      "bottom-24 left-[10%] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
    delay: "2s",
  },
  {
    Icon: IceCreamCone,
    className:
      "right-[14%] bottom-10 bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400",
    delay: "0.6s",
  },
] as const;

/**
 * Landing page: two clear doors — guests looking for food, restaurants
 * looking for customers — then how each side works.
 */
export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations("Marketing.home");

  return (
    <>
      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-gradient-to-b from-orange-50 via-amber-50/60 to-background dark:from-orange-950/40 dark:via-amber-950/40">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-24 -left-24 size-80 rounded-full bg-orange-300/40 blur-3xl motion-safe:animate-blob dark:bg-orange-500/15" />
          <div className="absolute top-20 -right-20 size-72 rounded-full bg-rose-300/30 blur-3xl [animation-delay:-6s] motion-safe:animate-blob dark:bg-rose-500/15" />
          <div className="absolute -bottom-20 left-1/3 size-72 rounded-full bg-emerald-200/40 blur-3xl [animation-delay:-12s] motion-safe:animate-blob dark:bg-emerald-500/15" />
          {FLOATING.map(({ Icon, className, delay }) => (
            <span
              key={delay}
              style={{ animationDelay: delay }}
              className={`absolute hidden size-12 place-items-center rounded-2xl shadow-sm motion-safe:animate-float md:grid ${className}`}
            >
              <Icon className="size-6" />
            </span>
          ))}
        </div>

        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 pt-16 pb-12 text-center sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white/70 px-3 py-1 text-xs font-medium text-orange-800 shadow-sm motion-safe:animate-in motion-safe:duration-700 motion-safe:fade-in dark:border-orange-800 dark:bg-card/70 dark:text-orange-300">
            <UtensilsCrossed className="size-3.5" aria-hidden />
            {t("badge")}
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-balance motion-safe:animate-in motion-safe:duration-700 motion-safe:fade-in motion-safe:slide-in-from-bottom-4 sm:text-6xl">
            {t("title")}
          </h1>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground motion-safe:animate-in motion-safe:delay-150 motion-safe:duration-700 motion-safe:fill-mode-backwards motion-safe:fade-in motion-safe:slide-in-from-bottom-4">
            {t("subtitle")}
          </p>
          <form
            action={getPathname({ href: "/restaurants", locale })}
            role="search"
            aria-label={t("searchLabel")}
            className="flex w-full max-w-lg gap-2 rounded-2xl bg-white p-2 shadow-lg ring-1 shadow-orange-900/5 ring-orange-100 motion-safe:animate-in motion-safe:delay-300 motion-safe:duration-700 motion-safe:fill-mode-backwards motion-safe:fade-in motion-safe:slide-in-from-bottom-4 dark:bg-card dark:ring-orange-900/50"
          >
            <label htmlFor="home-q" className="sr-only">
              {t("searchLabel")}
            </label>
            <Input
              id="home-q"
              name="q"
              type="search"
              placeholder={t("searchPlaceholder")}
              className="h-10 border-0 shadow-none focus-visible:ring-0"
            />
            <Button type="submit" size="lg" className="h-10 rounded-xl px-4">
              <Search aria-hidden />
              {t("search")}
            </Button>
          </form>
          <Link href="/restaurants" className="text-sm font-medium text-primary hover:underline">
            {t("browse")}
          </Link>
        </div>

        {/* The two doors */}
        <div className="mx-auto w-full max-w-5xl px-4 pb-16">
          <h2 className="mb-4 text-center text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            {t("doors.title")}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <article className="group relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-orange-700 to-rose-600 p-6 text-white shadow-xl shadow-orange-500/20 transition-transform motion-safe:hover:-translate-y-1 sm:p-8">
              <span className="grid size-12 place-items-center rounded-2xl bg-white/20">
                <UtensilsCrossed className="size-6" aria-hidden />
              </span>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-white">{t("doors.guest.label")}</p>
                <h3 className="text-2xl font-bold">{t("doors.guest.title")}</h3>
                <p className="text-white">{t("doors.guest.text")}</p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  size="lg"
                  className="h-auto min-h-10 rounded-xl bg-white px-4 py-2 whitespace-normal text-orange-800 hover:bg-orange-50 dark:bg-card dark:text-orange-300 dark:hover:bg-orange-950/40"
                  render={<Link href="/restaurants" />}
                >
                  {t("doors.guest.cta")}
                  <ArrowRight aria-hidden />
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="h-auto min-h-10 rounded-xl px-4 py-2 whitespace-normal text-white hover:bg-white/15 hover:text-white"
                  render={<a href="#guests" />}
                >
                  {t("doors.guest.more")}
                </Button>
              </div>
            </article>

            <article className="group relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-700 to-teal-800 p-6 text-white shadow-xl shadow-emerald-700/20 transition-transform motion-safe:hover:-translate-y-1 sm:p-8">
              <span className="grid size-12 place-items-center rounded-2xl bg-white/15">
                <Store className="size-6" aria-hidden />
              </span>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-white">{t("doors.restaurant.label")}</p>
                <h3 className="text-2xl font-bold">{t("doors.restaurant.title")}</h3>
                <p className="text-white">{t("doors.restaurant.text")}</p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  size="lg"
                  className="h-auto min-h-10 max-w-full rounded-xl bg-white px-4 py-2 whitespace-normal text-emerald-800 hover:bg-emerald-50 dark:bg-card dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                  render={<Link href="/register?for=restaurant" />}
                >
                  {t("ctaRestaurants")}
                  <ArrowRight aria-hidden />
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="h-auto min-h-10 rounded-xl px-4 py-2 whitespace-normal text-white hover:bg-white/15 hover:text-white"
                  render={<a href="#restaurants" />}
                >
                  {t("doors.restaurant.more")}
                </Button>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* For guests */}
      <section
        id="guests"
        aria-labelledby="guests-title"
        className="mx-auto w-full max-w-6xl scroll-mt-4 px-4 py-16 sm:py-20"
      >
        <div className="reveal mx-auto mb-10 flex max-w-2xl flex-col gap-3 text-center">
          <p className="text-sm font-semibold text-primary">{t("guests.eyebrow")}</p>
          <h2 id="guests-title" className="text-3xl font-bold tracking-tight text-balance">
            {t("guests.title")}
          </h2>
        </div>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GUEST_STEPS.map(([key, Icon], index) => (
            <li
              key={key}
              className="reveal relative flex flex-col gap-3 rounded-3xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="grid size-12 place-items-center rounded-2xl bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                  <Icon className="size-6" aria-hidden />
                </span>
                <span className="grid size-7 place-items-center rounded-full bg-orange-700 text-xs font-bold text-white">
                  {index + 1}
                </span>
              </div>
              <h3 className="text-lg font-semibold">{t(`guests.steps.${key}.title`)}</h3>
              <p className="text-sm text-muted-foreground">{t(`guests.steps.${key}.text`)}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex justify-center">
          <Button size="lg" className="h-10 rounded-xl px-5" render={<Link href="/restaurants" />}>
            {t("guests.cta")}
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </section>

      {/* For restaurants */}
      <section
        id="restaurants"
        aria-labelledby="restaurants-title"
        className="scroll-mt-4 bg-gradient-to-b from-emerald-50 to-background dark:from-emerald-950/40"
      >
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:py-20 lg:grid-cols-[2fr_3fr] lg:items-center">
          <div className="reveal flex flex-col gap-4">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {t("restaurants.eyebrow")}
            </p>
            <h2 id="restaurants-title" className="text-3xl font-bold tracking-tight text-balance">
              {t("restaurants.title")}
            </h2>
            <p className="text-muted-foreground">{t("restaurants.subtitle")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="h-auto min-h-10 max-w-full rounded-xl bg-emerald-700 px-5 py-2 whitespace-normal text-white hover:bg-emerald-800"
                render={<Link href="/register?for=restaurant" />}
              >
                {t("restaurants.cta")}
                <ArrowRight aria-hidden />
              </Button>
              <Link
                href="/contact"
                className="text-sm font-medium text-emerald-800 hover:underline dark:text-emerald-300"
              >
                {t("restaurants.talk")}
              </Link>
            </div>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {RESTAURANT_FEATURES.map(([key, Icon]) => (
              <li
                key={key}
                className="reveal flex gap-4 rounded-3xl border bg-card p-5 shadow-sm transition-transform motion-safe:hover:-translate-y-0.5"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="font-semibold">{t(`restaurants.features.${key}.title`)}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t(`restaurants.features.${key}.text`)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16">
        <div className="reveal relative isolate flex flex-col items-center gap-5 overflow-hidden rounded-3xl bg-gradient-to-br from-amber-100 via-orange-100 to-rose-100 px-6 py-12 text-center dark:from-amber-900/40 dark:via-orange-900/40 dark:to-rose-900/40">
          <CookingPot
            aria-hidden
            className="absolute -right-6 -bottom-6 -z-10 size-40 text-orange-200 motion-safe:animate-float dark:text-orange-900"
          />
          <MessageSquareHeart
            aria-hidden
            className="absolute -top-4 -left-4 -z-10 size-28 text-rose-200 [animation-delay:-3s] motion-safe:animate-float dark:text-rose-900"
          />
          <h2 className="max-w-xl text-2xl font-bold tracking-tight text-balance sm:text-3xl">
            {t("final.title")}
          </h2>
          <p className="max-w-lg text-muted-foreground">{t("final.text")}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              size="lg"
              className="h-10 rounded-xl px-5"
              render={<Link href="/restaurants" />}
            >
              {t("final.guestCta")}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-10 rounded-xl bg-white/70 px-5 dark:bg-card/70"
              render={<Link href="/login?for=restaurant" />}
            >
              {t("final.restaurantCta")}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
