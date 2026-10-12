import { describe, expect, it } from "vitest";

import { robotsRules, sitemapEntries } from "./sitemap";

describe("sitemapEntries", () => {
  it("lists every page in both languages, each pointing at the other", () => {
    const updated = new Date("2030-01-01");
    const home = { hy: "https://spot.am", en: "https://spot.am/en" };
    const ararat = { hy: "https://spot.am/r/ararat", en: "https://spot.am/en/r/ararat" };
    expect(
      sitemapEntries("https://spot.am/", [
        { path: "/", priority: 1 },
        { path: "/r/ararat", lastModified: updated },
      ]),
    ).toEqual([
      { url: home.hy, priority: 1, alternates: { languages: home } },
      { url: home.en, priority: 1, alternates: { languages: home } },
      { url: ararat.hy, lastModified: updated, alternates: { languages: ararat } },
      { url: ararat.en, lastModified: updated, alternates: { languages: ararat } },
    ]);
  });
});

describe("robotsRules", () => {
  it("keeps crawlers out of private areas in every language and points to the sitemap", () => {
    const robots = robotsRules("https://spot.am");
    const [rule] = robots.rules as { disallow: string[]; allow: string }[];
    expect(rule!.allow).toBe("/");
    for (const path of ["/dashboard", "/en/dashboard", "/account", "/en/table", "/t/", "/api/"]) {
      expect(rule!.disallow).toContain(path);
    }
    expect(rule!.disallow).not.toContain("/r/");
    expect(robots.sitemap).toBe("https://spot.am/sitemap.xml");
  });
});
