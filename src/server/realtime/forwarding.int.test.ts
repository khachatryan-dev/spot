import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { restaurantLocations, restaurants, users } from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { createGuest } from "@/server/guests/guest-service";
import { createCategory, createItem, createMenu } from "@/server/services/menu-service";
import { changeOrderStatus, createOrder } from "@/server/services/order-service";
import { ensureTableQr, resolveQrToken } from "@/server/services/qr-service";
import { createRestaurant } from "@/server/services/restaurant-service";
import { createTable } from "@/server/services/table-service";
import { createTableRequest, updateTableRequest } from "@/server/services/table-request-service";
import { joinTableSession } from "@/server/services/table-session-service";
import { truncate } from "@/test/db";

import { type RealtimeHint, realtimeChannels } from "./channels";
import { setRealtimePublisherForTests } from "./realtime";

const sent: { channel: string; hint: RealtimeHint }[] = [];
setRealtimePublisherForTests({
  publish: async (channel, hint) => void sent.push({ channel, hint }),
});
afterAll(() => setRealtimePublisherForTests(undefined));

beforeEach(async () => {
  await truncate(db, ["restaurants", "users", "guests", "rate_limits"]);
  sent.length = 0;
});

async function setup() {
  const [owner] = await db.insert(users).values({ email: "owner@example.am" }).returning();
  const restaurant = await createRestaurant(owner!, { name: "Live Cafe" });
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
  const table = await createTable(owner!, restaurant.id, { locationId: location!.id, number: "8" });
  const { token } = await ensureTableQr(owner!, restaurant.id, table.id);
  const menu = await createMenu(owner!, restaurant.id, {
    name: "Main",
    locationIds: [location!.id],
  });
  const category = await createCategory(owner!, restaurant.id, menu.id, { name: "Food" });
  const soup = await createItem(owner!, restaurant.id, {
    categoryId: category.id,
    name: "Soup",
    priceMinor: 200000,
  });
  const guest: Customer = { type: "guest", guest: (await createGuest()).guest };
  const session = await joinTableSession(guest, (await resolveQrToken(token))!);
  return {
    owner: owner!,
    restaurantId: restaurant.id,
    locationId: location!.id,
    soup,
    guest,
    session,
  };
}

describe("realtime forwarding", () => {
  it("sends hints for orders and requests to the location and the table session", async () => {
    const s = await setup();
    const staffChannel = realtimeChannels.location(s.restaurantId, s.locationId);
    const guestChannel = realtimeChannels.session(s.session.id);

    const order = await createOrder(s.guest, s.session.id, {
      lines: [{ itemId: s.soup.id, quantity: 1 }],
      idempotencyKey: "live-key-001",
    });
    await changeOrderStatus(s.owner, s.restaurantId, order.id, "accepted");
    const request = await createTableRequest(s.guest, s.session.id, { type: "bill" });
    await updateTableRequest(s.owner, s.restaurantId, request.id, "completed");

    const hints = (channel: string) => sent.filter((m) => m.channel === channel).map((m) => m.hint);
    const expected = [
      { type: "ORDER_CREATED", id: order.id },
      { type: "ORDER_STATUS_CHANGED", id: order.id, status: "accepted" },
      { type: "TABLE_REQUEST_CHANGED", id: request.id, status: "pending" },
      { type: "TABLE_REQUEST_CHANGED", id: request.id, status: "completed" },
    ];
    expect(hints(staffChannel)).toEqual(expected);
    expect(hints(guestChannel)).toEqual(expected);
    expect(new Set(sent.map((m) => m.channel))).toEqual(new Set([staffChannel, guestChannel]));
  });

  it("never sends prices, items or personal data", async () => {
    const s = await setup();
    await createOrder(s.guest, s.session.id, {
      lines: [{ itemId: s.soup.id, quantity: 2 }],
      idempotencyKey: "live-key-002",
    });
    for (const { hint } of sent) {
      expect(Object.keys(hint).sort()).toEqual(expect.arrayContaining(["id", "type"]));
      expect(Object.keys(hint).every((k) => ["type", "id", "status"].includes(k))).toBe(true);
    }
    expect(JSON.stringify(sent)).not.toMatch(/Soup|200000|400000|guest|email/i);
  });

  it("doesn't publish anything when the change fails", async () => {
    const s = await setup();
    await createOrder(s.guest, s.session.id, {
      lines: [{ itemId: s.soup.id, quantity: 1 }],
      idempotencyKey: "live-key-003",
    }).catch(() => null);
    sent.length = 0;
    await expect(
      createOrder({ type: "guest", guest: (await createGuest()).guest }, s.session.id, {
        lines: [{ itemId: s.soup.id, quantity: 1 }],
        idempotencyKey: "live-key-004",
      }),
    ).rejects.toThrow();
    expect(sent).toEqual([]);
  });
});
