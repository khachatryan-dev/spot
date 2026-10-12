import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { analyticsEvents, restaurants } from "@/server/db/schema";
import { truncate } from "@/test/db";

import { isBot, purgeOldAnalytics, track, visitorKeyOf } from "./track";

beforeEach(() => truncate(db, ["analytics_events", "restaurants"]));

describe("analytics", () => {
  it("tells crawlers from people", () => {
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBot("Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130 Mobile Safari")).toBe(false);
    expect(isBot(null)).toBe(true);
  });

  it("keys visitors anonymously but consistently", () => {
    const key = visitorKeyOf("user:123");
    expect(key).toBe(visitorKeyOf("user:123"));
    expect(key).not.toBe(visitorKeyOf("guest:123"));
    expect(key).not.toContain("123");
    expect(key).toHaveLength(32);
  });

  it("records events with a hashed visitor key and never throws", async () => {
    const [restaurant] = await db
      .insert(restaurants)
      .values({ name: "Cafe", slug: "cafe" })
      .returning();
    await track("restaurant_viewed", { restaurantId: restaurant!.id, identity: "guest:abc" });
    await track("search_performed", { properties: { hasQuery: true, results: 3 } });
    await track("qr_scanned", { restaurantId: "not-a-uuid" }); // swallowed
    const rows = await db.select().from(analyticsEvents).orderBy(analyticsEvents.occurredAt);
    expect(rows.map((r) => r.name)).toEqual(["restaurant_viewed", "search_performed"]);
    expect(rows[0]!.visitorKey).toBe(visitorKeyOf("guest:abc"));
    expect(rows[1]).toMatchObject({ visitorKey: null, properties: { hasQuery: true, results: 3 } });
  });

  it("deletes events older than the retention period", async () => {
    await track("search_performed");
    const now = new Date();
    expect(await purgeOldAnalytics(now)).toBe(0);
    expect(await purgeOldAnalytics(new Date(now.getTime() + 401 * 86_400_000))).toBe(1);
  });
});
