import { CalendarDays, MapPin, Search } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { MapView } from "@/components/shared/map-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NearMeButton } from "@/features/discover/near-me-button";
import { Stars } from "@/features/reviews/stars";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { trackPageEvent } from "@/server/analytics/track";
import {
  listSearchCities,
  PAGE_SIZE,
  searchQuerySchema,
  searchRestaurants,
  SORTS,
} from "@/server/services/restaurant-search-service";
import { CUISINES, type Cuisine } from "@/shared/constants/cuisines";
import { bookingPath } from "@/shared/utils/booking-url";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Discover");
  return { title: t("title"), description: t("metaDescription") };
}

const select =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/** Restaurant discovery (§26): search, filters, sorting. Everything lives in the URL. */
export default async function DiscoverPage({
  params,
  searchParams,
}: PageProps<"/[locale]/restaurants">) {
  const locale = await resolveLocale(params);
  const raw = await searchParams;
  const query = searchQuerySchema.parse(raw);
  const cuisineNames = Object.fromEntries(CUISINES.map((c) => [c, [] as string[]])) as Record<
    Cuisine,
    string[]
  >;
  for (const locale of routing.locales) {
    const names = await getTranslations({ locale, namespace: "Cuisines" });
    for (const c of CUISINES) cuisineNames[c].push(names(c));
  }
  const [{ results, total }, cities] = await Promise.all([
    searchRestaurants(query, cuisineNames),
    listSearchCities(),
  ]);
  await trackPageEvent("search_performed", {
    properties: {
      hasQuery: query.q.length > 0,
      filters: [query.cuisine, query.price, query.city, query.reservable, query.openNow].filter(
        Boolean,
      ).length,
      nearMe: query.near !== null,
      results: total,
    },
  });
  const t = await getTranslations("Discover");
  const cuisine = await getTranslations("Cuisines");
  const r = await getTranslations("Reviews");
  const format = await getFormatter();
  const kept = Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <form role="search" aria-label={t("searchLabel")} className="flex flex-col gap-3">
        {query.near && (
          <input type="hidden" name="near" value={`${query.near.lat},${query.near.lng}`} />
        )}
        {raw.view === "map" && <input type="hidden" name="view" value="map" />}
        <div className="flex gap-2">
          <label htmlFor="q" className="sr-only">
            {t("searchLabel")}
          </label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder={t("placeholder")}
          />
          <Button type="submit">
            <Search aria-hidden />
            {t("search")}
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <Label htmlFor="cuisine">{t("cuisine")}</Label>
            <select
              id="cuisine"
              name="cuisine"
              defaultValue={query.cuisine ?? ""}
              className={select}
            >
              <option value="">{t("any")}</option>
              {CUISINES.map((c) => (
                <option key={c} value={c}>
                  {cuisine(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="price">{t("price")}</Label>
            <select id="price" name="price" defaultValue={query.price ?? ""} className={select}>
              <option value="">{t("any")}</option>
              {[1, 2, 3, 4].map((p) => (
                <option key={p} value={p}>
                  {"֏".repeat(p)}
                </option>
              ))}
            </select>
          </div>
          {cities.length > 1 && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="city">{t("city")}</Label>
              <select id="city" name="city" defaultValue={query.city ?? ""} className={select}>
                <option value="">{t("any")}</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="sort">{t("sort")}</Label>
            <select id="sort" name="sort" defaultValue={query.sort} className={select}>
              {SORTS.filter((s) => s !== "distance" || query.near).map((s) => (
                <option key={s} value={s}>
                  {t(`sorts.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <label className="flex h-8 items-center gap-2">
            <input
              type="checkbox"
              name="reservable"
              value="1"
              defaultChecked={query.reservable}
              className="size-4 accent-primary"
            />
            {t("reservable")}
          </label>
          <label className="flex h-8 items-center gap-2">
            <input
              type="checkbox"
              name="openNow"
              value="1"
              defaultChecked={query.openNow}
              className="size-4 accent-primary"
            />
            {t("openNow")}
          </label>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-muted-foreground">
          {t("found", { count: total })}
          {query.near && <> · {t("sortedByDistance")}</>}
        </p>
        <div className="flex flex-wrap gap-2">
          <NearMeButton params={kept} />
          <nav aria-label={t("viewLabel")} className="flex rounded-lg border p-0.5">
            {(["list", "map"] as const).map((view) => {
              const current = (raw.view === "map" ? "map" : "list") === view;
              return (
                <Link
                  key={view}
                  href={{ pathname: "/restaurants", query: { ...kept, view } }}
                  aria-current={current ? "page" : undefined}
                  className="rounded-md px-3 py-1 text-sm aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
                >
                  {t(`views.${view}`)}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      {raw.view === "map" && (
        <MapView
          label={t("mapLabel")}
          you={query.near}
          pins={results.flatMap((r) =>
            r.pins.map((pin) => ({
              ...pin,
              label: r.pins.length > 1 ? `${r.name} — ${pin.name}` : r.name,
              href: localizePath(`/r/${r.slug}`, locale),
            })),
          )}
          className="h-96 w-full overflow-hidden rounded-2xl border"
        />
      )}
      {results.length === 0 ? (
        <p className="text-sm">{t("empty")}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("resultsLabel")}>
          {results.map((restaurant) => (
            <li key={restaurant.id} className="flex flex-col overflow-hidden rounded-2xl border">
              {restaurant.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote storage, already resized
                <img
                  src={restaurant.coverUrl}
                  alt=""
                  className="aspect-[16/9] w-full object-cover"
                />
              ) : (
                <div className="aspect-[16/9] w-full bg-muted" aria-hidden />
              )}
              <div className="flex flex-1 flex-col gap-2 p-4">
                <h2 className="text-lg font-semibold">
                  <Link
                    href={`/r/${restaurant.slug}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {restaurant.name}
                  </Link>
                </h2>
                {restaurant.reviewCount > 0 && restaurant.rating !== null && (
                  <span className="flex items-center gap-2 text-sm">
                    <Stars
                      rating={restaurant.rating}
                      label={r("averageLabel", { average: restaurant.rating })}
                    />
                    {r("count", { count: restaurant.reviewCount })}
                  </span>
                )}
                <div className="flex flex-wrap gap-1">
                  {restaurant.cuisines.slice(0, 3).map((c) => (
                    <Badge key={c} variant="outline">
                      {cuisine(c)}
                    </Badge>
                  ))}
                  {restaurant.priceRange && (
                    <Badge variant="outline">{"֏".repeat(restaurant.priceRange)}</Badge>
                  )}
                  {restaurant.openNow && <Badge>{t("openBadge")}</Badge>}
                </div>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="size-4" aria-hidden />
                  {restaurant.cities.join(", ")}
                  {restaurant.distanceKm !== null && (
                    <>
                      {" "}
                      ·{" "}
                      {t("distance", {
                        km: format.number(restaurant.distanceKm, { maximumFractionDigits: 1 }),
                      })}
                    </>
                  )}
                </span>
                {restaurant.bookingLocationSlug && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-auto self-start"
                    render={
                      <Link href={bookingPath(restaurant.slug, restaurant.bookingLocationSlug)} />
                    }
                    aria-label={t("reserveAt", { name: restaurant.name })}
                  >
                    <CalendarDays aria-hidden />
                    {t("reserve")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {total > results.length && (
        <Button
          variant="outline"
          className="self-center"
          render={
            <Link
              href={{
                pathname: "/restaurants",
                query: { ...kept, limit: String(query.limit + PAGE_SIZE) },
              }}
              scroll={false}
            />
          }
        >
          {t("more")}
        </Button>
      )}
    </div>
  );
}
