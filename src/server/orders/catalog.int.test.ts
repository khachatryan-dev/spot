import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { menuItems, restaurantLocations, users } from "@/server/db/schema";
import { createCategory, createItem, createMenu, updateMenu } from "@/server/services/menu-service";
import { createRestaurant } from "@/server/services/restaurant-service";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import { priceOrderRequest } from "./catalog";

beforeEach(() => truncate(db, ["restaurants", "users"]));

const FRIDAY_LUNCH = new Date("2026-10-02T13:00:00+04:00");

async function setup() {
  const [owner] = await db.insert(users).values({ email: "owner@example.am" }).returning();
  const restaurant = await createRestaurant(owner!, { name: "Price Cafe" });
  const [main, other] = await db
    .insert(restaurantLocations)
    .values([
      {
        restaurantId: restaurant.id,
        name: "Main",
        slug: "main",
        addressLine: "1 St",
        city: "Yerevan",
      },
      {
        restaurantId: restaurant.id,
        name: "Other",
        slug: "other",
        addressLine: "2 St",
        city: "Yerevan",
      },
    ])
    .returning();
  const menu = await createMenu(owner!, restaurant.id, { name: "Main", locationIds: [main!.id] });
  const category = await createCategory(owner!, restaurant.id, menu.id, { name: "Soups" });
  const khash = await createItem(owner!, restaurant.id, {
    categoryId: category.id,
    name: "Խաշ",
    priceMinor: 400000,
    translations: { en: { name: "Khash" } },
  });
  return {
    owner: owner!,
    restaurantId: restaurant.id,
    mainId: main!.id,
    otherId: other!.id,
    menu,
    khash,
  };
}

const req = (itemId: string, quantity = 1) => ({
  lines: [{ itemId, quantity }],
  idempotencyKey: "checkout-0001",
});

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) =>
      e instanceof AppError ? `${e.code}:${JSON.stringify(e.fieldErrors)}` : (e as Error).name,
  );

describe("priceOrderRequest (live catalog)", () => {
  it("uses the current database price and the original (untranslated) name", async () => {
    const { restaurantId, mainId, khash } = await setup();
    let { priced } = await priceOrderRequest(restaurantId, mainId, req(khash.id, 2), FRIDAY_LUNCH);
    expect(priced).toMatchObject({
      totalMinor: 800000,
      lines: [{ name: "Խաշ", unitPriceMinor: 400000 }],
    });

    await db.update(menuItems).set({ priceMinor: 450000 }).where(eq(menuItems.id, khash.id));
    ({ priced } = await priceOrderRequest(restaurantId, mainId, req(khash.id, 2), FRIDAY_LUNCH));
    expect(priced.totalMinor).toBe(900000);
  });

  it("accepts only what guests at that location can order right now", async () => {
    const { owner, restaurantId, mainId, otherId, menu, khash } = await setup();
    // Menu not served at the other location
    expect(
      await codeOf(priceOrderRequest(restaurantId, otherId, req(khash.id), FRIDAY_LUNCH)),
    ).toBe('ORDER_UNAVAILABLE:{"lines.0":["itemUnavailable"]}');
    // Outside menu hours
    await updateMenu(owner, restaurantId, menu.id, {
      availableHours: {
        mon: [],
        tue: [],
        wed: [],
        thu: [],
        fri: [{ open: "18:00", close: "23:00" }],
        sat: [],
        sun: [],
      },
    });
    expect(await codeOf(priceOrderRequest(restaurantId, mainId, req(khash.id), FRIDAY_LUNCH))).toBe(
      'ORDER_UNAVAILABLE:{"lines.0":["itemUnavailable"]}',
    );
    await expect(
      priceOrderRequest(restaurantId, mainId, req(khash.id), new Date("2026-10-02T19:00:00+04:00")),
    ).resolves.toBeDefined();
  });

  it("rejects hidden and out-of-stock items", async () => {
    const { restaurantId, mainId, khash } = await setup();
    await db.update(menuItems).set({ isAvailable: false }).where(eq(menuItems.id, khash.id));
    expect(await codeOf(priceOrderRequest(restaurantId, mainId, req(khash.id), FRIDAY_LUNCH))).toBe(
      'ORDER_UNAVAILABLE:{"lines.0":["outOfStock"]}',
    );
    await db
      .update(menuItems)
      .set({ isAvailable: true, isActive: false })
      .where(eq(menuItems.id, khash.id));
    expect(await codeOf(priceOrderRequest(restaurantId, mainId, req(khash.id), FRIDAY_LUNCH))).toBe(
      'ORDER_UNAVAILABLE:{"lines.0":["itemUnavailable"]}',
    );
  });

  it("never prices another restaurant's items, even with a valid id", async () => {
    const { khash, mainId } = await setup();
    const [other] = await db.insert(users).values({ email: "other@example.am" }).returning();
    const theirs = await createRestaurant(other!, { name: "Other place" });
    expect(await codeOf(priceOrderRequest(theirs.id, mainId, req(khash.id), FRIDAY_LUNCH))).toBe(
      'ORDER_UNAVAILABLE:{"lines.0":["itemUnavailable"]}',
    );
  });
});
