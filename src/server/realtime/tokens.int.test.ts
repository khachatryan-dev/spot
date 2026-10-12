import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { restaurantLocations, restaurants, restaurantStaff, users } from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { createGuest } from "@/server/guests/guest-service";
import { ensureTableQr, resolveQrToken } from "@/server/services/qr-service";
import { createRestaurant } from "@/server/services/restaurant-service";
import { createTable } from "@/server/services/table-service";
import { joinTableSession, leaveTableSession } from "@/server/services/table-session-service";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import { realtimeChannels } from "./channels";
import { authorizeRealtimeChannel, createChannelToken } from "./tokens";

beforeEach(() => truncate(db, ["restaurants", "users", "guests"]));

const FAKE_KEY = "appId.keyId:secretSecretSecret";

async function setup() {
  const [owner] = await db.insert(users).values({ email: "owner@example.am" }).returning();
  const restaurant = await createRestaurant(owner!, { name: "Token Cafe" });
  await db.update(restaurants).set({ status: "active" }).where(eq(restaurants.id, restaurant.id));
  const [location] = await db
    .insert(restaurantLocations)
    .values({
      restaurantId: restaurant.id,
      name: "Main",
      slug: "main",
      addressLine: "1 St",
      city: "Yerevan",
    })
    .returning();
  const table = await createTable(owner!, restaurant.id, { locationId: location!.id, number: "2" });
  const { token } = await ensureTableQr(owner!, restaurant.id, table.id);
  const guest: Customer = { type: "guest", guest: (await createGuest()).guest };
  const session = await joinTableSession(guest, (await resolveQrToken(token))!);
  return { owner: owner!, restaurantId: restaurant.id, locationId: location!.id, guest, session };
}

const nobody = { user: null, customer: null, tableSessionId: undefined };
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).name),
  );

describe("authorizeRealtimeChannel", () => {
  it("lets staff with order access listen to their location", async () => {
    const s = await setup();
    const channel = realtimeChannels.location(s.restaurantId, s.locationId);
    await expect(
      authorizeRealtimeChannel(channel, { ...nobody, user: s.owner }),
    ).resolves.toBeUndefined();

    const [cook] = await db.insert(users).values({ email: "cook@example.am" }).returning();
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: s.restaurantId, userId: cook!.id, role: "kitchen" });
    await expect(
      authorizeRealtimeChannel(channel, { ...nobody, user: cook! }),
    ).resolves.toBeUndefined();
  });

  it("refuses outsiders, signed-out visitors and mismatched locations", async () => {
    const s = await setup();
    const channel = realtimeChannels.location(s.restaurantId, s.locationId);
    expect(await codeOf(authorizeRealtimeChannel(channel, nobody))).toBe("UNAUTHORIZED");

    const [outsider] = await db.insert(users).values({ email: "out@example.am" }).returning();
    expect(await codeOf(authorizeRealtimeChannel(channel, { ...nobody, user: outsider! }))).toBe(
      "NOT_FOUND",
    );

    // Own restaurant id with another restaurant's location id
    const own = await createRestaurant(outsider!, { name: "Own place" });
    expect(
      await codeOf(
        authorizeRealtimeChannel(realtimeChannels.location(own.id, s.locationId), {
          ...nobody,
          user: outsider!,
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("lets only current members of the visit listen to its channel", async () => {
    const s = await setup();
    const channel = realtimeChannels.session(s.session.id);
    const member = { ...nobody, customer: s.guest, tableSessionId: s.session.id };
    await expect(authorizeRealtimeChannel(channel, member)).resolves.toBeUndefined();

    const stranger: Customer = { type: "guest", guest: (await createGuest()).guest };
    expect(
      await codeOf(
        authorizeRealtimeChannel(channel, {
          ...nobody,
          customer: stranger,
          tableSessionId: s.session.id,
        }),
      ),
    ).toBe("FORBIDDEN");
    // Cookie pointing at a different visit than the channel asked for
    expect(
      await codeOf(
        authorizeRealtimeChannel(channel, { ...member, tableSessionId: crypto.randomUUID() }),
      ),
    ).toBe("FORBIDDEN");

    await leaveTableSession(s.guest, s.session.id);
    expect(await codeOf(authorizeRealtimeChannel(channel, member))).toBe("FORBIDDEN");
  });

  it("rejects unknown channel names", async () => {
    const s = await setup();
    for (const channel of [
      "*",
      "restaurant:*",
      "session:not-a-uuid",
      "admin",
      `session:${s.session.id}:extra`,
    ]) {
      expect(await codeOf(authorizeRealtimeChannel(channel, { ...nobody, user: s.owner }))).toBe(
        "NOT_FOUND",
      );
    }
  });
});

describe("createChannelToken", () => {
  it("signs a subscribe-only token for one channel, offline, with an anonymous client id", async () => {
    const channel = realtimeChannels.session(crypto.randomUUID());
    const request = await createChannelToken(FAKE_KEY, channel);
    expect(request.keyName).toBe("appId.keyId");
    expect(JSON.parse(request.capability as string)).toEqual({ [channel]: ["subscribe"] });
    expect(request.ttl).toBe(60 * 60 * 1000);
    expect(request.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.mac).toBeTruthy();
    expect(JSON.stringify(request)).not.toContain("secretSecretSecret");
  });

  it("refuses wildcard or malformed channels", async () => {
    for (const channel of ["*", "session:*", "restaurant:x:location:y"]) {
      await expect(createChannelToken(FAKE_KEY, channel)).rejects.toThrow();
    }
  });
});
