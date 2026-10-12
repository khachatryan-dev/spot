import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { truncate } from "@/test/db";

import { menuCategories, menuItems, menuLocations, menus, modifierGroups, modifiers } from "./menu";
import { restaurantLocations, restaurants } from "./restaurants";

beforeEach(() => truncate(db, ["restaurants"]));

async function restaurantWithMenu(slug: string) {
  const [restaurant] = await db.insert(restaurants).values({ name: slug, slug }).returning();
  const [menu] = await db
    .insert(menus)
    .values({ restaurantId: restaurant!.id, name: "Main menu" })
    .returning();
  const [category] = await db
    .insert(menuCategories)
    .values({ restaurantId: restaurant!.id, menuId: menu!.id, name: "Pizza" })
    .returning();
  const [item] = await db
    .insert(menuItems)
    .values({
      restaurantId: restaurant!.id,
      categoryId: category!.id,
      name: "Margherita",
      priceMinor: 3500,
    })
    .returning();
  return { restaurant: restaurant!, menu: menu!, category: category!, item: item! };
}

describe("menu tenant integrity (enforced by the database)", () => {
  it("won't put a category under another restaurant's menu", async () => {
    const a = await restaurantWithMenu("a");
    const b = await restaurantWithMenu("b");
    await expect(
      db
        .insert(menuCategories)
        .values({ restaurantId: a.restaurant.id, menuId: b.menu.id, name: "Sneaky" }),
    ).rejects.toThrow();
  });

  it("won't put an item into another restaurant's category", async () => {
    const a = await restaurantWithMenu("a");
    const b = await restaurantWithMenu("b");
    await expect(
      db.insert(menuItems).values({
        restaurantId: a.restaurant.id,
        categoryId: b.category.id,
        name: "X",
        priceMinor: 1,
      }),
    ).rejects.toThrow();
  });

  it("won't attach a menu to another restaurant's location", async () => {
    const a = await restaurantWithMenu("a");
    const b = await restaurantWithMenu("b");
    const [bLocation] = await db
      .insert(restaurantLocations)
      .values({
        restaurantId: b.restaurant.id,
        name: "B",
        slug: "b",
        addressLine: "1 St",
        city: "Yerevan",
      })
      .returning();
    await expect(
      db
        .insert(menuLocations)
        .values({ menuId: a.menu.id, locationId: bLocation!.id, restaurantId: a.restaurant.id }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(menuLocations)
        .values({ menuId: a.menu.id, locationId: bLocation!.id, restaurantId: b.restaurant.id }),
    ).rejects.toThrow();
  });

  it("won't move an item to another restaurant by changing its restaurant id", async () => {
    const a = await restaurantWithMenu("a");
    const b = await restaurantWithMenu("b");
    await expect(
      db
        .update(menuItems)
        .set({ restaurantId: b.restaurant.id })
        .where(eq(menuItems.id, a.item.id)),
    ).rejects.toThrow();
  });
});

describe("menu rules", () => {
  it("rejects negative or absurd prices", async () => {
    const { restaurant, category } = await restaurantWithMenu("a");
    for (const priceMinor of [-1, 100_000_001]) {
      await expect(
        db
          .insert(menuItems)
          .values({ restaurantId: restaurant.id, categoryId: category.id, name: "X", priceMinor }),
      ).rejects.toThrow();
    }
  });

  it("accepts only known allergens and dietary tags", async () => {
    const { restaurant, category } = await restaurantWithMenu("a");
    const base = {
      restaurantId: restaurant.id,
      categoryId: category.id,
      name: "X",
      priceMinor: 100,
    };
    await expect(
      db
        .insert(menuItems)
        .values({ ...base, allergens: ["gluten", "milk"], dietaryTags: ["vegetarian"] }),
    ).resolves.toBeDefined();
    await expect(
      db.insert(menuItems).values({ ...base, allergens: ["unicorn" as never] }),
    ).rejects.toThrow();
    await expect(
      db.insert(menuItems).values({ ...base, dietaryTags: ["keto" as never] }),
    ).rejects.toThrow();
  });

  it("validates modifier group selection limits and modifier prices", async () => {
    const { restaurant, item } = await restaurantWithMenu("a");
    const group = { restaurantId: restaurant.id, itemId: item.id, name: "Size" };
    await expect(
      db.insert(modifierGroups).values({ ...group, minSelect: 2, maxSelect: 1 }),
    ).rejects.toThrow();
    await expect(
      db.insert(modifierGroups).values({ ...group, minSelect: 0, maxSelect: 0 }),
    ).rejects.toThrow();

    const [size] = await db
      .insert(modifierGroups)
      .values({ ...group, minSelect: 1, maxSelect: 1 })
      .returning();
    await expect(
      db.insert(modifiers).values({
        restaurantId: restaurant.id,
        groupId: size!.id,
        name: "Small",
        priceDeltaMinor: -100,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(modifiers).values({
        restaurantId: restaurant.id,
        groupId: size!.id,
        name: "Large",
        priceDeltaMinor: 500,
      }),
    ).resolves.toBeDefined();
  });

  it("removes the whole tree when a menu is deleted", async () => {
    const { restaurant, menu, item } = await restaurantWithMenu("a");
    const [group] = await db
      .insert(modifierGroups)
      .values({ restaurantId: restaurant.id, itemId: item.id, name: "Size" })
      .returning();
    await db
      .insert(modifiers)
      .values({ restaurantId: restaurant.id, groupId: group!.id, name: "L" });

    await db.delete(menus).where(eq(menus.id, menu.id));
    expect(await db.select().from(menuItems)).toHaveLength(0);
    expect(await db.select().from(modifiers)).toHaveLength(0);
  });

  it("stores translations alongside the default language", async () => {
    const { restaurant, category } = await restaurantWithMenu("a");
    const [item] = await db
      .insert(menuItems)
      .values({
        restaurantId: restaurant.id,
        categoryId: category.id,
        name: "Խորոված",
        priceMinor: 4500,
        translations: { en: { name: "Barbecue" }, ru: { name: "Шашлык" } },
      })
      .returning();
    expect(item?.translations.en?.name).toBe("Barbecue");
  });
});
