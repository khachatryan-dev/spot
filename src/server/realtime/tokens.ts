import "server-only";

import { randomUUID } from "node:crypto";

import Ably from "ably";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { restaurantLocations } from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { getCustomerTableSession } from "@/server/services/table-session-service";
import { AppError } from "@/shared/errors";

import { realtimeChannels } from "./channels";

/*
 * Browser tokens for realtime (ADR 0001). A token allows *subscribing* to
 * exactly one channel the requester may see, for one hour, under a random
 * client id (no personal data goes to the provider).
 */

const TOKEN_TTL_MS = 60 * 60 * 1000;

const locationChannel = /^restaurant:([0-9a-f-]{36}):location:([0-9a-f-]{36})$/;
const sessionChannel = /^session:([0-9a-f-]{36})$/;

export interface Requester {
  user: Pick<SessionUser, "id"> | null;
  customer: Customer | null;
  tableSessionId: string | undefined;
}

/** Throws unless the requester may listen on `channel`. */
export async function authorizeRealtimeChannel(channel: string, who: Requester): Promise<void> {
  const location = locationChannel.exec(channel);
  if (location) {
    const [, restaurantId, locationId] = location as unknown as [string, string, string];
    if (!who.user) throw new AppError("UNAUTHORIZED");
    await authorizeRestaurant(who.user.id, restaurantId, "order:read");
    const [row] = await db
      .select({ id: restaurantLocations.id })
      .from(restaurantLocations)
      .where(
        and(
          eq(restaurantLocations.id, locationId),
          eq(restaurantLocations.restaurantId, restaurantId),
        ),
      );
    if (!row) throw new AppError("NOT_FOUND", "Location not found.");
    return;
  }

  const session = sessionChannel.exec(channel);
  if (session) {
    const [, sessionId] = session as unknown as [string, string];
    // Only a current member of that open visit; the table cookie must match too.
    if (!who.customer || who.tableSessionId !== sessionId) throw new AppError("FORBIDDEN");
    if (!(await getCustomerTableSession(who.customer, sessionId))) throw new AppError("FORBIDDEN");
    return;
  }

  throw new AppError("NOT_FOUND", "Unknown channel.");
}

/** Signed token request for one channel, subscribe only. Signed locally with the API key. */
export async function createChannelToken(apiKey: string, channel: string) {
  z.string()
    .regex(new RegExp(`${locationChannel.source}|${sessionChannel.source}`))
    .parse(channel);
  const rest = new Ably.Rest({ key: apiKey, queryTime: false });
  return rest.auth.createTokenRequest({
    clientId: randomUUID(),
    capability: { [channel]: ["subscribe"] },
    ttl: TOKEN_TTL_MS,
  });
}

export { realtimeChannels };
