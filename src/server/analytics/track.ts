import "server-only";

import { createHmac } from "node:crypto";

import { lt } from "drizzle-orm";
import { headers } from "next/headers";
import { after } from "next/server";

import { db } from "@/server/db/client";
import { analyticsEvents } from "@/server/db/schema";
import { getCustomer } from "@/server/guests/current-customer";
import { logger } from "@/server/logger";
import { env } from "@/shared/config/env";
import { ANALYTICS_RETENTION_DAYS, type AnalyticsEvent } from "@/shared/constants/analytics";

/*
 * Product analytics (§4.2), kept in our own database: no third parties, no
 * tracking cookies. Visitors are counted through a keyed hash of their
 * account or guest id, which can't be turned back into the person.
 */

const log = logger.child({ module: "analytics" });

/** Crawlers and monitoring tools aren't visitors. */
const BOT = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|curl|wget|python-requests/i;
export const isBot = (userAgent: string | null) => !userAgent || BOT.test(userAgent);

/** A stable, anonymous visitor key ("user:…" or "guest:…" hashed with the server secret). */
export const visitorKeyOf = (identity: string) =>
  createHmac("sha256", env.AUTH_SECRET).update(identity).digest("base64url").slice(0, 32);

export interface TrackInput {
  restaurantId?: string | null;
  locationId?: string | null;
  /** "user:<id>" or "guest:<id>"; hashed before storing. */
  identity?: string | null;
  properties?: Record<string, string | number | boolean>;
}

/** Store an event now. Never throws: analytics must never break a page. */
export async function track(name: AnalyticsEvent, input: TrackInput = {}) {
  try {
    await db.insert(analyticsEvents).values({
      name,
      restaurantId: input.restaurantId ?? null,
      locationId: input.locationId ?? null,
      visitorKey: input.identity ? visitorKeyOf(input.identity) : null,
      properties: input.properties ?? {},
    });
  } catch (err) {
    log.warn("Couldn't record analytics event", { err, name });
  }
}

/**
 * Record an event for the current page request, after the response is sent.
 * Skips crawlers and link prefetches (they aren't visits).
 */
export async function trackPageEvent(
  name: AnalyticsEvent,
  input: Omit<TrackInput, "identity"> = {},
) {
  const request = await headers();
  if (isBot(request.get("user-agent")) || request.get("next-router-prefetch")) return;
  const customer = await getCustomer();
  const identity = customer
    ? customer.type === "user"
      ? `user:${customer.user.id}`
      : `guest:${customer.guest.id}`
    : null;
  after(() => track(name, { ...input, identity }));
}

/** Drop events older than the retention period (daily job). */
export async function purgeOldAnalytics(now = new Date()) {
  const deleted = await db
    .delete(analyticsEvents)
    .where(
      lt(
        analyticsEvents.occurredAt,
        new Date(now.getTime() - ANALYTICS_RETENTION_DAYS * 86_400_000),
      ),
    )
    .returning({ id: analyticsEvents.id });
  return deleted.length;
}
