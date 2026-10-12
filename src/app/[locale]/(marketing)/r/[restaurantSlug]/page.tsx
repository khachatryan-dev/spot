import { CalendarDays, Clock, ExternalLink, Globe, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
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

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />

      {restaurant.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- remote storage, already resized
        <img
          src={restaurant.coverUrl}
          alt=""
          className="aspect-[3/1] w-full rounded-2xl object-cover"
        />
      )}
      <header className="flex items-start gap-4">
        {restaurant.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- remote storage, already resized
          <img
            src={restaurant.logoUrl}
            alt={t("logoAlt", { name: restaurant.name })}
            className="size-16 shrink-0 rounded-xl border object-cover"
          />
        )}
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-3xl font-semibold">{restaurant.name}</h1>
            <FavoriteButton
              restaurantId={restaurant.id}
              restaurantName={restaurant.name}
              saved={saved}
              loginHref={
                session ? null : `/login?next=${encodeURIComponent(localizePath(selfPath, locale))}`
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {restaurant.cuisines.map((c) => (
              <Badge key={c} variant="outline">
                {cuisine(c)}
              </Badge>
            ))}
            {restaurant.priceRange && (
              <Badge
                variant="outline"
                aria-label={t("priceLevel", { level: restaurant.priceRange })}
              >
                {"֏".repeat(restaurant.priceRange)}
              </Badge>
            )}
          </div>
        </div>
      </header>

      {restaurant.description && (
        <p className="text-base whitespace-pre-line text-muted-foreground">
          {restaurant.description}
        </p>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        {restaurant.phone && (
          <a href={`tel:${restaurant.phone}`} className="flex items-center gap-1 hover:underline">
            <Phone className="size-4" aria-hidden />
            {restaurant.phone}
          </a>
        )}
        {restaurant.website && (
          <a
            href={restaurant.website}
            rel="noopener nofollow"
            target="_blank"
            className="flex items-center gap-1 hover:underline"
          >
            <Globe className="size-4" aria-hidden />
            {t("website")}
          </a>
        )}
      </div>

      <ReviewSummary {...summary} />

      <section aria-labelledby="locations-heading" className="flex flex-col gap-3">
        <h2 id="locations-heading" className="text-xl font-semibold">
          {t("locationsTitle", { count: restaurant.locations.length })}
        </h2>
        <ul className="flex flex-col gap-3">
          {restaurant.locations.map((l) => {
            const mapQuery =
              l.latitude !== null && l.longitude !== null
                ? `${l.latitude},${l.longitude}`
                : `${l.addressLine}, ${l.city}`;
            return (
              <li key={l.id} className="flex flex-col gap-3 rounded-2xl border p-4">
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
                    <Button render={<Link href={bookingPath(restaurant.slug, l.slug)} />}>
                      <CalendarDays aria-hidden />
                      {t("reserve")}
                    </Button>
                  )}
                </div>
                <details className="text-sm">
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
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
                  target="_blank"
                  rel="noopener"
                  className="flex items-center gap-1 self-start text-sm font-medium hover:underline"
                >
                  <ExternalLink className="size-4" aria-hidden />
                  {t("map")}
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      {shown && menus.length > 0 && (
        <section aria-labelledby="menu-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="menu-heading" className="text-xl font-semibold">
              {t("menuTitle")}
            </h2>
            {restaurant.locations.length > 1 && (
              <nav aria-label={t("menuLocation")} className="flex flex-wrap gap-2 text-sm">
                {restaurant.locations.map((l) => (
                  <Link
                    key={l.id}
                    href={{ pathname: selfPath, query: { location: l.slug } }}
                    aria-current={l.id === shown.id ? "page" : undefined}
                    className="rounded-full border px-3 py-1 aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
                  >
                    {l.name}
                  </Link>
                ))}
              </nav>
            )}
          </div>
          {menus.map((menu) => (
            <div key={menu.id} className="flex flex-col gap-4">
              {menus.length > 1 && <h3 className="text-lg font-semibold">{menu.name}</h3>}
              {menu.categories.map((category) => (
                <div key={category.id} className="flex flex-col gap-2">
                  <h4 className="font-semibold">{category.name}</h4>
                  <ul className="flex flex-col divide-y rounded-2xl border">
                    {category.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-3 p-3 text-sm">
                        <span className="flex flex-col">
                          <span className="font-medium">{item.name}</span>
                          {item.description && (
                            <span className="text-muted-foreground">{item.description}</span>
                          )}
                        </span>
                        <span className="tabular-nums">
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
    </article>
  );
}
