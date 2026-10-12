import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { menuItems, restaurantLocations, users } from "@/server/db/schema";
import { truncate } from "@/test/db";

import { getCustomerMenus } from "./customer-menu-service";
import {
  createCategory,
  createItem,
  createMenu,
  createModifier,
  createModifierGroup,
  setItemAvailability,
  setModifierAvailability,
  updateCategory,
  updateItem,
  updateMenu,
} from "./menu-service";
import { createRestaurant } from "./restaurant-service";

beforeEach(() => truncate(db, ["restaurants", "users"]));

/** Friday 2026-10-02, 13:00 in Yerevan. */
const FRIDAY_LUNCH = new Date("2026-10-02T13:00:00+04:00");

async function setup() {
  const [owner] = await db.insert(users).values({ email: "owner@example.am" }).returning();
  const restaurant = await createRestaurant(owner!, { name: "Menu Cafe" });
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
  const menu = await createMenu(owner!, restaurant.id, {
    name: "Main menu",
    locationIds: [main!.id],
  });
  const salads = await createCategory(owner!, restaurant.id, menu.id, { name: "Աղցաններ" });
  const caesar = await createItem(owner!, restaurant.id, {
    categoryId: salads.id,
    name: "Կեսար",
    priceMinor: 350000,
    allergens: ["eggs", "milk"],
    translations: { en: { name: "Caesar" } },
  });
  return {
    owner: owner!,
    restaurantId: restaurant.id,
    mainId: main!.id,
    otherId: other!.id,
    menu,
    salads,
    caesar,
  };
}

const names = (menus: Awaited<ReturnType<typeof getCustomerMenus>>) =>
  menus.flatMap((m) => m.categories.flatMap((c) => c.items.map((i) => i.name)));

describe("getCustomerMenus", () => {
  it("shows the location's menus with prices, allergens and translations", async () => {
    const { restaurantId, mainId } = await setup();

    const [menu] = await getCustomerMenus(restaurantId, mainId, "hy", FRIDAY_LUNCH);
    expect(menu?.categories[0]).toMatchObject({
      name: "Աղցաններ",
      items: [
        {
          name: "Կեսար",
          priceMinor: 350000,
          allergens: ["eggs", "milk"],
          unavailable: null,
          hasOptions: false,
        },
      ],
    });
    expect(names(await getCustomerMenus(restaurantId, mainId, "en", FRIDAY_LUNCH))).toEqual([
      "Caesar",
    ]);
  });

  it("only shows menus attached to that location", async () => {
    const { restaurantId, otherId } = await setup();
    expect(await getCustomerMenus(restaurantId, otherId, "hy", FRIDAY_LUNCH)).toEqual([]);
  });

  it("never sends hidden menus, categories or items", async () => {
    const { owner, restaurantId, mainId, menu, salads, caesar } = await setup();
    const hidden = await createItem(owner, restaurantId, {
      categoryId: salads.id,
      name: "Secret",
      priceMinor: 1,
    });
    await updateItem(owner, restaurantId, hidden.id, { isActive: false });
    expect(names(await getCustomerMenus(restaurantId, mainId, "hy", FRIDAY_LUNCH))).toEqual([
      "Կեսար",
    ]);

    await updateCategory(owner, restaurantId, salads.id, { isActive: false });
    expect(await getCustomerMenus(restaurantId, mainId, "hy", FRIDAY_LUNCH)).toEqual([]);
    await updateCategory(owner, restaurantId, salads.id, { isActive: true });

    await updateMenu(owner, restaurantId, menu.id, { isActive: false });
    expect(await getCustomerMenus(restaurantId, mainId, "hy", FRIDAY_LUNCH)).toEqual([]);
    expect(caesar.id).toBeDefined();
  });

  it("flags out-of-stock items and items whose required options are gone", async () => {
    const { owner, restaurantId, mainId, caesar } = await setup();
    await setItemAvailability(owner, restaurantId, caesar.id, false);
    let [menu] = await getCustomerMenus(restaurantId, mainId, "hy", FRIDAY_LUNCH);
    expect(menu?.categories[0]?.items[0]?.unavailable).toBe("outOfStock");

    await setItemAvailability(owner, restaurantId, caesar.id, true);
    const size = await createModifierGroup(owner, restaurantId, caesar.id, {
      name: "Size",
      minSelect: 1,
      maxSelect: 1,
    });
    const large = await createModifier(owner, restaurantId, size.id, { name: "Large" });
    await setModifierAvailability(owner, restaurantId, large.id, false);
    [menu] = await getCustomerMenus(restaurantId, mainId, "hy", FRIDAY_LUNCH);
    expect(menu?.categories[0]?.items[0]).toMatchObject({
      unavailable: "requiredOptionUnavailable",
      hasOptions: true,
    });
  });

  it("respects location opening hours and menu hours", async () => {
    const { owner, restaurantId, mainId, menu } = await setup();
    // No hours configured → not restricted.
    expect(await getCustomerMenus(restaurantId, mainId, "hy", FRIDAY_LUNCH)).toHaveLength(1);

    await db
      .update(restaurantLocations)
      .set({
        openingHours: {
          mon: [],
          tue: [],
          wed: [],
          thu: [],
          fri: [{ open: "18:00", close: "23:00" }],
          sat: [],
          sun: [],
        },
      })
      .where(eq(restaurantLocations.id, mainId));
    expect(await getCustomerMenus(restaurantId, mainId, "hy", FRIDAY_LUNCH)).toEqual([]);
    expect(
      await getCustomerMenus(restaurantId, mainId, "hy", new Date("2026-10-02T19:00:00+04:00")),
    ).toHaveLength(1);

    await updateMenu(owner, restaurantId, menu.id, {
      availableHours: {
        mon: [],
        tue: [],
        wed: [],
        thu: [],
        fri: [{ open: "20:00", close: "22:00" }],
        sat: [],
        sun: [],
      },
    });
    expect(
      await getCustomerMenus(restaurantId, mainId, "hy", new Date("2026-10-02T19:00:00+04:00")),
    ).toEqual([]);
    expect(
      await getCustomerMenus(restaurantId, mainId, "hy", new Date("2026-10-02T21:00:00+04:00")),
    ).toHaveLength(1);
  });

  it("returns nothing for another restaurant's location id", async () => {
    const { mainId } = await setup();
    const [other] = await db.insert(users).values({ email: "x@example.am" }).returning();
    const theirs = await createRestaurant(other!, { name: "Other place" });
    expect(await getCustomerMenus(theirs.id, mainId, "hy", FRIDAY_LUNCH)).toEqual([]);
    expect(await db.select().from(menuItems)).toHaveLength(1);
  });
});
