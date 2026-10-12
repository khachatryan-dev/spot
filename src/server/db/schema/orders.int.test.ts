import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { truncate } from "@/test/db";

import { menuCategories, menuItems, menus } from "./menu";
import { orderItemModifiers, orderItems, orders, orderStatusHistory } from "./orders";
import { restaurantLocations, restaurants } from "./restaurants";
import { tableSessions } from "./table-sessions";
import { diningTables } from "./tables";

beforeEach(() => truncate(db, ["restaurants"]));

/** A restaurant with a location, table 1, an open session and a menu item. */
async function setup(slug = "cafe") {
  const [restaurant] = await db.insert(restaurants).values({ name: slug, slug }).returning();
  const restaurantId = restaurant!.id;
  const [location] = await db
    .insert(restaurantLocations)
    .values({ restaurantId, name: "Main", slug: "main", addressLine: "1 St", city: "Yerevan" })
    .returning();
  const [table] = await db
    .insert(diningTables)
    .values({ restaurantId, locationId: location!.id, number: "1" })
    .returning();
  const [session] = await db
    .insert(tableSessions)
    .values({ restaurantId, tableId: table!.id, code: "ABC234" })
    .returning();
  const [menu] = await db.insert(menus).values({ restaurantId, name: "Main" }).returning();
  const [category] = await db
    .insert(menuCategories)
    .values({ restaurantId, menuId: menu!.id, name: "Pizza" })
    .returning();
  const [item] = await db
    .insert(menuItems)
    .values({ restaurantId, categoryId: category!.id, name: "Margherita", priceMinor: 350000 })
    .returning();
  return {
    restaurantId,
    locationId: location!.id,
    tableId: table!.id,
    sessionId: session!.id,
    itemId: item!.id,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const order = (s: Setup, extra: Partial<typeof orders.$inferInsert> = {}) => ({
  restaurantId: s.restaurantId,
  locationId: s.locationId,
  tableId: s.tableId,
  tableSessionId: s.sessionId,
  number: 1,
  currency: "AMD",
  subtotalMinor: 700000,
  totalMinor: 700000,
  idempotencyKey: "key-00000001",
  ...extra,
});

async function placedOrder(s: Setup) {
  const [o] = await db.insert(orders).values(order(s)).returning();
  const [line] = await db
    .insert(orderItems)
    .values({
      restaurantId: s.restaurantId,
      orderId: o!.id,
      menuItemId: s.itemId,
      name: "Margherita",
      unitPriceMinor: 300000,
      modifiersTotalMinor: 50000,
      quantity: 2,
      lineTotalMinor: 700000,
    })
    .returning();
  await db.insert(orderItemModifiers).values({
    restaurantId: s.restaurantId,
    orderItemId: line!.id,
    modifierId: null,
    groupName: "Size",
    name: "Large",
    priceDeltaMinor: 50000,
  });
  return { order: o!, line: line! };
}

describe("orders", () => {
  it("checks totals and amounts", async () => {
    const s = await setup();
    await expect(db.insert(orders).values(order(s, { totalMinor: 1 }))).rejects.toThrow();
    await expect(
      db.insert(orders).values(order(s, { discountMinor: 800000, totalMinor: -100000 })),
    ).rejects.toThrow();
    await expect(db.insert(orders).values(order(s, { currency: "amd" }))).rejects.toThrow();
    await expect(
      db.insert(orders).values(order(s, { discountMinor: 100000, totalMinor: 600000 })),
    ).resolves.toBeDefined();
  });

  it("numbers orders uniquely per restaurant and refuses duplicate submissions", async () => {
    const a = await setup("a");
    const b = await setup("b");
    await db.insert(orders).values(order(a));
    await db.insert(orders).values(order(b)); // #1 at another restaurant is fine
    await expect(
      db.insert(orders).values(order(a, { idempotencyKey: "key-00000002" })),
    ).rejects.toThrow(); // #1 again
    await expect(db.insert(orders).values(order(a, { number: 2 }))).rejects.toThrow(); // same idempotency key
  });

  it("keeps an order inside its own restaurant's table, location and session", async () => {
    const a = await setup("a");
    const b = await setup("b");
    await expect(db.insert(orders).values(order(a, { tableId: b.tableId }))).rejects.toThrow();
    await expect(
      db.insert(orders).values(order(a, { locationId: b.locationId })),
    ).rejects.toThrow();
    await expect(
      db.insert(orders).values(order(a, { tableSessionId: b.sessionId })),
    ).rejects.toThrow();
  });

  it("can't be deleted, and its amounts can't change — but its status can", async () => {
    const s = await setup();
    const { order: o } = await placedOrder(s);

    const error = await db
      .delete(orders)
      .where(eq(orders.id, o.id))
      .then(
        () => null,
        (e: { cause?: { message?: string } }) => e,
      );
    expect(error?.cause?.message).toMatch(/financial records are immutable/);
    await expect(
      db.update(orders).set({ totalMinor: 1, subtotalMinor: 1 }).where(eq(orders.id, o.id)),
    ).rejects.toThrow();
    await expect(
      db.update(orders).set({ currency: "USD" }).where(eq(orders.id, o.id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(orders)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(eq(orders.id, o.id)),
    ).resolves.toBeDefined();
  });
});

describe("order lines", () => {
  it("check line totals and quantities", async () => {
    const s = await setup();
    const { order: o } = await placedOrder(s);
    const line = {
      restaurantId: s.restaurantId,
      orderId: o.id,
      name: "X",
      unitPriceMinor: 100,
      quantity: 2,
      lineTotalMinor: 200,
    };
    await expect(db.insert(orderItems).values({ ...line, lineTotalMinor: 199 })).rejects.toThrow();
    await expect(
      db.insert(orderItems).values({ ...line, quantity: 0, lineTotalMinor: 0 }),
    ).rejects.toThrow();
    await expect(
      db.insert(orderItems).values({ ...line, quantity: 51, lineTotalMinor: 5100 }),
    ).rejects.toThrow();
  });

  it("can't be edited or deleted after the order is placed", async () => {
    const s = await setup();
    const { line } = await placedOrder(s);
    await expect(
      db.update(orderItems).set({ unitPriceMinor: 1 }).where(eq(orderItems.id, line.id)),
    ).rejects.toThrow();
    await expect(db.delete(orderItems).where(eq(orderItems.id, line.id))).rejects.toThrow();
    await expect(db.update(orderItemModifiers).set({ priceDeltaMinor: 0 })).rejects.toThrow();
  });

  it("keep their snapshot when the menu item is repriced or deleted", async () => {
    const s = await setup();
    const { line } = await placedOrder(s);
    await db.update(menuItems).set({ priceMinor: 999900 }).where(eq(menuItems.id, s.itemId));
    expect(
      (await db.select().from(orderItems).where(eq(orderItems.id, line.id)))[0]?.unitPriceMinor,
    ).toBe(300000);

    // Owners can still delete the menu item; the line keeps its snapshot.
    await db.delete(menuItems).where(eq(menuItems.id, s.itemId));
    const [kept] = await db.select().from(orderItems).where(eq(orderItems.id, line.id));
    expect(kept).toMatchObject({
      name: "Margherita",
      unitPriceMinor: 300000,
      menuItemId: s.itemId,
    });
  });
});

describe("status history", () => {
  it("is append-only", async () => {
    const s = await setup();
    const { order: o } = await placedOrder(s);
    const [entry] = await db
      .insert(orderStatusHistory)
      .values({
        restaurantId: s.restaurantId,
        orderId: o.id,
        fromStatus: null,
        toStatus: "submitted",
      })
      .returning();
    await expect(
      db
        .update(orderStatusHistory)
        .set({ toStatus: "completed" })
        .where(eq(orderStatusHistory.id, entry!.id)),
    ).rejects.toThrow();
    await expect(db.delete(orderStatusHistory)).rejects.toThrow();
  });
});
