import type { MetadataRoute } from "next";

import { clientEnv } from "@/shared/config/env.client";
import { robotsRules } from "@/shared/seo/sitemap";

/** /robots.txt: crawl public pages, never private areas (§39). */
export default function robots(): MetadataRoute.Robots {
  return robotsRules(clientEnv.NEXT_PUBLIC_APP_URL);
}
