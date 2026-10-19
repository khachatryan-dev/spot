import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { listPublicRestaurantsForSitemap } from "@/server/services/public-restaurant-service";
import { clientEnv } from "@/shared/config/env.client";
import { sitemapEntries } from "@/shared/seo/sitemap";

/** /sitemap.xml: public pages and every approved restaurant, in both languages (§39). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection(); // read the database per request, not at build time
  const restaurants = await listPublicRestaurantsForSitemap();
  return sitemapEntries(clientEnv.NEXT_PUBLIC_APP_URL, [
    { path: "/", priority: 1 },
    { path: "/restaurants", priority: 0.9 },
    ...["/about", "/contact", "/faq"].map((path) => ({ path, priority: 0.5 })),
    ...["/privacy", "/terms"].map((path) => ({ path, priority: 0.3 })),
    ...restaurants.map((r) => ({ path: `/r/${r.slug}`, lastModified: r.updatedAt, priority: 0.8 })),
  ]);
}
