import {
  CalendarDays,
  Clock,
  ExternalLink,
  Globe,
  MapPin,
  Navigation,
  Phone,
  Star,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { FavoriteButton } from "@/features/account/favorite-button";
import { ReviewSummary } from "@/features/reviews/review-summary";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { trackPageEvent } from "@/server/analytics/track";
import { getSession } from "@/server/auth/session";
import { isFavorite } from "@/server/services/account-service";
import { getCustomerMenus } from "@/server/services/customer-menu-service";
import { getPublicRestaurant } from "@/server/services/public-restaurant-service";
import { getReviewSummary } from "@/server/services/review-service";
import { clientEnv } from "@/shared/config/env.client";
import { isOpenAt } from "@/shared/domain/availability";
import { restaurantJsonLd, safeJsonLd } from "@/shared/domain/restaurant-structured-data";
import { WEEKDAYS } from "@/shared/schemas/opening-hours";
import { bookingPath, bookingUrl } from "@/shared/utils/booking-url";
import { formatMoney } from "@/shared/utils/money";

type Props = PageProps<"/[locale]/r/[restaurantSlug]">;

const absolute = (path: string) => `${clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}${path}`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, restaurantSlug } = await params;
  const restaurant = await getPublicRestaurant(restaurantSlug);
  if (!restaurant) return { robots: { index: false } };
  const t = await getTranslations({ locale: locale as "hy", namespace: "PublicRestaurant" });
  const city = restaurant.locations[0]?.city;
  const description =
    restaurant.description?.slice(0, 160) ??
    t("metaDescription", { name: restaurant.name, city: city ?? "" });
  const path = `/r/${restaurant.slug}`;
  return {
    title: city ? t("metaTitle", { name: restaurant.name, city }) : restaurant.name,
    description,
    alternates: {
      canonical: localizePath(path, locale as "hy"),
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, localizePath(path, l)])),
        "x-default": path,
      },
    },
    openGraph: {
      type: "website",
      title: restaurant.name,
      description,
      url: localizePath(path, locale as "hy"),
      locale: locale === "hy" ? "hy_AM" : "en_US",
      ...(restaurant.coverUrl && { images: [{ url: restaurant.coverUrl }] }),
    },
  };
}

/** The public page of an approved restaurant (§26, §39). */
export default async function PublicRestaurantPage({ params, searchParams }: Props) {
  const locale = await resolveLocale(params);
  const { restaurantSlug } = await params;
  const restaurant = await getPublicRestaurant(restaurantSlug);
  if (!restaurant) notFound();

  const { location: requested } = await searchParams;
  const shown =
    restaurant.locations.find((l) => l.slug === requested) ?? restaurant.locations[0] ?? null;
  const [summary, menus, session] = await Promise.all([
    getReviewSummary(restaurant.id),
    shown ? getCustomerMenus(restaurant.id, shown.id, locale, new Date(), true) : [],
    getSession(),
  ]);
  const saved = session ? await isFavorite(session.user, restaurant.id) : false;
  await trackPageEvent("restaurant_viewed", { restaurantId: restaurant.id });
  const t = await getTranslations("PublicRestaurant");
  const cuisine = await getTranslations("Cuisines");
  const weekday = await getTranslations("Weekdays");
  const selfPath = `/r/${restaurant.slug}`;

  const jsonLd = restaurantJsonLd({
    name: restaurant.name,
    url: absolute(localizePath(selfPath, locale)),
    description: restaurant.description,
    imageUrls: [restaurant.coverUrl, restaurant.logoUrl].filter((u): u is string => !!u),
    cuisines: restaurant.cuisines.map((c) => cuisine(c)),
    priceRange: restaurant.priceRange,
    phone: restaurant.phone,
    rating: summary.average !== null ? { average: summary.average, count: summary.count } : null,
    locations: restaurant.locations.map((l) => ({
      ...l,
      url: absolute(localizePath(selfPath, locale)),
      bookingUrl: l.reservationsEnabled ? bookingUrl(restaurant.slug, l.slug) : null,
    })),
  });

  const format = await getFormatter();
  const openNow = shown ? isOpenAt(shown.openingHours, shown.timezone, new Date()) : false;
  const bookable = restaurant.locations.find((l) => l.reservationsEnabled);
  const mapQueryOf = (l: (typeof restaurant.locations)[number]) =>
    l.latitude !== null && l.longitude !== null
      ? `${l.latitude},${l.longitude}`
      : `${l.addressLine}, ${l.city}`;
  const mapsUrl = (l: (typeof restaurant.locations)[number]) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQueryOf(l))}`;

  const actions = [
    restaurant.phone && {
      key: "call",
      href: `tel:${restaurant.phone}`,
      Icon: Phone,
      external: false,
    },
    shown && { key: "directions", href: mapsUrl(shown), Icon: Navigation, external: true },
    restaurant.website && { key: "website", href: restaurant.website, Icon: Globe, external: true },
  ].filter(
    (
      a,
    ): a is {
      key: "call" | "directions" | "website";
      href: string;
      Icon: typeof Phone;
      external: boolean;
    } => !!a,
  );

  return (
    <article className="flex flex-1 flex-col bg-muted/40 pb-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />

      {/* Hero: photo (or a warm gradient) with the name over it */}
      <div className="relative isolate mx-auto w-full max-w-3xl overflow-hidden sm:mt-4 sm:rounded-3xl">
        {restaurant.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote storage, already resized
          <img
            src={restaurant.coverUrl}
            alt=""
            className="absolute inset-0 -z-20 size-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0 -z-20 bg-gradient-to-br from-orange-600 to-rose-600"
          />
        )}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/30 to-transparent"
        />
        <div className="flex min-h-56 flex-col justify-end gap-3 p-5 pt-16 text-white">
          <div className="flex items-end gap-3">
            {restaurant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote storage, already resized
              <img
                src={restaurant.logoUrl}
                alt={t("logoAlt", { name: restaurant.name })}
                className="size-16 shrink-0 rounded-2xl border-2 border-white object-cover shadow-lg"
              />
            ) : (
              <span
                aria-hidden
                className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white text-3xl font-black text-orange-700 shadow-lg"
              >
                {restaurant.name.trim().charAt(0)}
              </span>
            )}
            <h1 className="flex-1 text-3xl font-bold text-balance drop-shadow">
              {restaurant.name}
            </h1>
            <div className="rounded-full bg-white text-neutral-900 shadow">
              <FavoriteButton
                restaurantId={restaurant.id}
                restaurantName={restaurant.name}
                saved={saved}
                loginHref={
                  session
                    ? null
                    : `/login?next=${encodeURIComponent(localizePath(selfPath, locale))}`
                }
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {summary.average !== null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-neutral-900">
                <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden />
                {format.number(summary.average, { maximumFractionDigits: 1 })}
                <span className="font-medium text-neutral-600">({summary.count})</span>
              </span>
            )}
            {shown && (
              <span
                className={
                  openNow
                    ? "rounded-full bg-emerald-700 px-2.5 py-1 text-white"
                    : "rounded-full bg-neutral-800 px-2.5 py-1 text-white"
                }
              >
                {t(openNow ? "openNow" : "closedNow")}
              </span>
            )}
            {restaurant.priceRange && (
              <span
                className="rounded-full bg-black/40 px-2.5 py-1 text-white"
                aria-label={t("priceLevel", { level: restaurant.priceRange })}
                role="img"
              >
                {"֏".repeat(restaurant.priceRange)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-4">
        {/* Quick actions, like a banking app's action tiles */}
        <ul className="grid grid-cols-4 gap-2">
          {bookable && (
            <li>
              <Link
                href={bookingPath(restaurant.slug, bookable.slug)}
                className="flex flex-col items-center gap-1.5 rounded-2xl bg-primary p-3 text-center text-xs font-semibold text-primary-foreground shadow-sm"
              >
                <CalendarDays className="size-5" aria-hidden />
                {t("book")}
              </Link>
            </li>
          )}
          {actions.map(({ key, href, Icon, external }) => (
            <li key={key}>
              <a
                href={href}
                {...(external ? { target: "_blank", rel: "noopener nofollow" } : {})}
                className="flex flex-col items-center gap-1.5 rounded-2xl bg-card p-3 text-center text-xs font-semibold shadow-sm ring-1 ring-border hover:bg-orange-50 dark:hover:bg-orange-950/40"
              >
                <Icon className="size-5 text-primary" aria-hidden />
                {t(key)}
              </a>
            </li>
          ))}
        </ul>

        <section className="flex flex-col gap-3 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border">
          <div className="flex flex-wrap gap-2">
            {restaurant.cuisines.map((c) => (
              <span
                key={c}
                className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
              >
                {cuisine(c)}
              </span>
            ))}
          </div>
          {restaurant.description && (
            <p className="text-sm whitespace-pre-line text-muted-foreground">
              {restaurant.description}
            </p>
          )}
        </section>

        <div className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border">
          <ReviewSummary {...summary} />
        </div>

        <section aria-labelledby="locations-heading" className="flex flex-col gap-3">
          <h2 id="locations-heading" className="px-1 text-lg font-bold">
            {t("locationsTitle", { count: restaurant.locations.length })}
          </h2>
          <ul className="flex flex-col gap-3">
            {restaurant.locations.map((l) => (
              <li
                key={l.id}
                className="flex flex-col gap-3 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <h3 className="font-semibold">{l.name}</h3>
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="size-4 shrink-0" aria-hidden />
                      {l.addressLine}, {l.city}
                    </span>
                    {l.phone && (
                      <a
                        href={`tel:${l.phone}`}
                        className="flex items-center gap-1 text-sm hover:underline"
                      >
                        <Phone className="size-4" aria-hidden />
                        {l.phone}
                      </a>
                    )}
                  </div>
                  {l.reservationsEnabled && (
                    <Button
                      className="rounded-full"
                      render={<Link href={bookingPath(restaurant.slug, l.slug)} />}
                    >
                      <CalendarDays aria-hidden />
                      {t("reserve")}
                    </Button>
                  )}
                </div>
                <details className="rounded-2xl bg-muted/60 px-3 py-2 text-sm">
                  <summary className="flex cursor-pointer items-center gap-1 font-medium">
                    <Clock className="size-4" aria-hidden />
                    {t("hours")}
                  </summary>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    {WEEKDAYS.map((day) => (
                      <div key={day} className="contents">
                        <dt className="text-muted-foreground">{weekday(day)}</dt>
                        <dd className="tabular-nums">
                          {(l.openingHours[day] ?? []).length === 0
                            ? t("closed")
                            : l.openingHours[day]!.map((p) => `${p.open}–${p.close}`).join(", ")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
                <a
                  href={mapsUrl(l)}
                  target="_blank"
                  rel="noopener"
                  className="flex items-center gap-1 self-start text-sm font-medium text-primary hover:underline"
                >
                  <ExternalLink className="size-4" aria-hidden />
                  {t("map")}
                </a>
              </li>
            ))}
          </ul>
        </section>

        {shown && menus.length > 0 && (
          <section aria-labelledby="menu-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
              <h2 id="menu-heading" className="text-lg font-bold">
                {t("menuTitle")}
              </h2>
              {restaurant.locations.length > 1 && (
                <nav aria-label={t("menuLocation")} className="flex flex-wrap gap-2 text-sm">
                  {restaurant.locations.map((l) => (
                    <Link
                      key={l.id}
                      href={{ pathname: selfPath, query: { location: l.slug } }}
                      aria-current={l.id === shown.id ? "page" : undefined}
                      className="rounded-full bg-card px-3 py-1 ring-1 ring-border aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground aria-[current=page]:ring-primary"
                    >
                      {l.name}
                    </Link>
                  ))}
                </nav>
              )}
            </div>
            {menus.map((menu) => (
              <div key={menu.id} className="flex flex-col gap-4">
                {menus.length > 1 && <h3 className="px-1 font-semibold">{menu.name}</h3>}
                {menu.categories.map((category) => (
                  <div key={category.id} className="flex flex-col gap-2">
                    <h4 className="px-1 text-sm font-semibold text-muted-foreground uppercase">
                      {category.name}
                    </h4>
                    <ul className="flex flex-col divide-y rounded-3xl bg-card shadow-sm ring-1 ring-border">
                      {category.items.map((item) => (
                        <li key={item.id} className="flex items-center gap-3 p-3 text-sm">
                          {item.imageUrl && (
                            <Image
                              src={item.imageUrl}
                              alt=""
                              width={56}
                              height={56}
                              unoptimized
                              className="size-14 shrink-0 rounded-xl object-cover"
                            />
                          )}
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="font-medium">{item.name}</span>
                            {item.description && (
                              <span className="line-clamp-2 text-muted-foreground">
                                {item.description}
                              </span>
                            )}
                          </span>
                          <span className="font-bold whitespace-nowrap text-primary tabular-nums">
                            {formatMoney(item.priceMinor, restaurant.currency, locale)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </section>
        )}
      </div>
    </article>
  );
}
