import { CalendarDays, MapPin, Search, SlidersHorizontal, Star } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { MapView } from "@/components/shared/map-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NearMeButton } from "@/features/discover/near-me-button";
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

/** Filters look like app chips; they stay real form controls (keyboard, screen readers). */
const select =
  "h-9 rounded-full border-0 bg-card px-3 text-sm font-medium shadow-sm ring-1 ring-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const toggle =
  "flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-card px-3 text-sm font-medium whitespace-nowrap shadow-sm ring-1 ring-border has-checked:bg-orange-50 has-checked:ring-primary dark:has-checked:bg-orange-950/40";

/** Popular cuisines as one-tap chips above the filters. */
const QUICK_CUISINES: Cuisine[] = [
  "armenian",
  "georgian",
  "italian",
  "japanese",
  "cafe",
  "burgers",
];

/** A cover for places without a photo: a warm gradient picked from the name. */
const COVERS = [
  "from-orange-500 to-rose-500",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-fuchsia-600",
  "from-emerald-600 to-teal-700",
  "from-sky-600 to-indigo-600",
];
const coverOf = (name: string) =>
  COVERS[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % COVERS.length]!;

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
    <div className="flex flex-1 flex-col bg-muted/40">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <form role="search" aria-label={t("searchLabel")} className="flex flex-col gap-3">
          {query.near && (
            <input type="hidden" name="near" value={`${query.near.lat},${query.near.lng}`} />
          )}
          {raw.view === "map" && <input type="hidden" name="view" value="map" />}
          <div className="flex gap-2 rounded-2xl bg-card p-1.5 shadow-sm ring-1 ring-border">
            <label htmlFor="q" className="sr-only">
              {t("searchLabel")}
            </label>
            <span className="grid place-items-center pl-2 text-muted-foreground" aria-hidden>
              <Search className="size-5" />
            </span>
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={query.q}
              placeholder={t("placeholder")}
              className="h-10 border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <Button type="submit" size="lg" className="h-10 rounded-xl px-4">
              {t("search")}
            </Button>
          </div>

          {/* One-tap cuisines */}
          <nav
            aria-label={t("quickCuisines")}
            className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4"
          >
            <ul className="flex gap-2">
              {QUICK_CUISINES.map((c) => {
                const active = query.cuisine === c;
                return (
                  <li key={c}>
                    <Link
                      href={{
                        pathname: "/restaurants",
                        query: { ...kept, cuisine: active ? "" : c, limit: "" },
                      }}
                      aria-current={active ? "true" : undefined}
                      className="block rounded-full bg-orange-100 px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-orange-800 aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground dark:bg-orange-900/40 dark:text-orange-300"
                    >
                      {cuisine(c)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Filters: a scrollable row of chips */}
          <div className="relative -mx-4 flex [scrollbar-width:none] items-center gap-2 overflow-x-auto px-4 pb-1">
            <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Label htmlFor="cuisine" className="sr-only">
              {t("cuisine")}
            </Label>
            <select
              id="cuisine"
              name="cuisine"
              defaultValue={query.cuisine ?? ""}
              className={select}
            >
              <option value="">{t("anyCuisine")}</option>
              {CUISINES.map((c) => (
                <option key={c} value={c}>
                  {cuisine(c)}
                </option>
              ))}
            </select>
            <Label htmlFor="price" className="sr-only">
              {t("price")}
            </Label>
            <select id="price" name="price" defaultValue={query.price ?? ""} className={select}>
              <option value="">{t("anyPrice")}</option>
              {[1, 2, 3, 4].map((p) => (
                <option key={p} value={p}>
                  {"֏".repeat(p)}
                </option>
              ))}
            </select>
            {cities.length > 1 && (
              <>
                <Label htmlFor="city" className="sr-only">
                  {t("city")}
                </Label>
                <select id="city" name="city" defaultValue={query.city ?? ""} className={select}>
                  <option value="">{t("anyCity")}</option>
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label className={toggle}>
              <input
                type="checkbox"
                name="openNow"
                value="1"
                defaultChecked={query.openNow}
                className="size-4 accent-primary"
              />
              {t("openNow")}
            </label>
            <label className={toggle}>
              <input
                type="checkbox"
                name="reservable"
                value="1"
                defaultChecked={query.reservable}
                className="size-4 accent-primary"
              />
              {t("reservable")}
            </label>
            <Label htmlFor="sort" className="sr-only">
              {t("sort")}
            </Label>
            <select id="sort" name="sort" defaultValue={query.sort} className={select}>
              {SORTS.filter((s) => s !== "distance" || query.near).map((s) => (
                <option key={s} value={s}>
                  {t(`sorts.${s}`)}
                </option>
              ))}
            </select>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm font-medium text-muted-foreground">
            {t("found", { count: total })}
            {query.near && <> · {t("sortedByDistance")}</>}
          </p>
          <div className="flex flex-wrap gap-2">
            <NearMeButton params={kept} />
            <nav
              aria-label={t("viewLabel")}
              className="flex rounded-full bg-card p-1 shadow-sm ring-1 ring-border"
            >
              {(["list", "map"] as const).map((view) => {
                const current = (raw.view === "map" ? "map" : "list") === view;
                return (
                  <Link
                    key={view}
                    href={{ pathname: "/restaurants", query: { ...kept, view } }}
                    aria-current={current ? "page" : undefined}
                    className="rounded-full px-3 py-1 text-sm font-medium aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
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
            className="h-96 w-full overflow-hidden rounded-3xl shadow-sm ring-1 ring-border"
          />
        )}
        {results.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-3xl bg-card p-10 text-center shadow-sm ring-1 ring-border">
            <Search className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm">{t("empty")}</p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("resultsLabel")}>
            {results.map((restaurant) => (
              <li
                key={restaurant.id}
                className="group relative flex flex-col overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-border transition-shadow hover:shadow-md"
              >
                <div className="relative aspect-[16/9] w-full overflow-hidden">
                  {restaurant.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote storage, already resized
                    <img
                      src={restaurant.coverUrl}
                      alt=""
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div
                      aria-hidden
                      className={`grid size-full place-items-center bg-gradient-to-br text-6xl font-black text-white/90 ${coverOf(restaurant.name)}`}
                    >
                      {restaurant.name.trim().charAt(0)}
                    </div>
                  )}
                  <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
                    {restaurant.reviewCount > 0 && restaurant.rating !== null ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-neutral-900 shadow">
                        <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
                        <span aria-hidden>
                          {format.number(restaurant.rating, { maximumFractionDigits: 1 })}{" "}
                          <span className="font-medium text-neutral-600">
                            ({restaurant.reviewCount})
                          </span>
                        </span>
                        <span className="sr-only">
                          {r("averageLabel", { average: restaurant.rating })},{" "}
                          {r("count", { count: restaurant.reviewCount })}
                        </span>
                      </span>
                    ) : (
                      <span />
                    )}
                    {restaurant.openNow && (
                      <span className="rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-bold text-white shadow">
                        {t("openBadge")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <h2 className="text-lg font-bold">
                    {/* The whole card opens the restaurant. */}
                    <Link
                      href={`/r/${restaurant.slug}`}
                      className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                    >
                      {restaurant.name}
                    </Link>
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {[
                      ...restaurant.cuisines.slice(0, 2).map((c) => cuisine(c)),
                      restaurant.priceRange ? "֏".repeat(restaurant.priceRange) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="size-4 shrink-0" aria-hidden />
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
                      className="relative z-10 mt-auto self-start rounded-full px-3"
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
            className="self-center rounded-full"
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
    </div>
  );
}
