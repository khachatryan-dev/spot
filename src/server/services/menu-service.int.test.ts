import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  auditLogs,
  menuItems,
  restaurantLocations,
  restaurantStaff,
  users,
} from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import {
  createCategory,
  createItem,
  createMenu,
  createModifier,
  createModifierGroup,
  deleteCategory,
  deleteItem,
  deleteMenu,
  deleteModifier,
  deleteModifierGroup,
  getMenuTree,
  listMenus,
  reorder,
  setItemAvailability,
  setModifierAvailability,
  updateCategory,
  updateItem,
  updateMenu,
  updateModifier,
  updateModifierGroup,
} from "./menu-service";
import { createRestaurant } from "./restaurant-service";

beforeEach(() => truncate(db, ["audit_logs", "restaurants", "users"]));

async function createUser(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  return user!;
}

async function addStaff(
  restaurantId: string,
  email: string,
  role: "manager" | "waiter" | "kitchen",
) {
  const user = await createUser(email);
  await db.insert(restaurantStaff).values({ restaurantId, userId: user.id, role });
  return user;
}

/** A restaurant with one menu → category → item → group → modifier. */
async function seed(slug: string) {
  const owner = await createUser(`${slug}@example.am`);
  const restaurant = await createRestaurant(owner, { name: `${slug} cafe` });
  const menu = await createMenu(owner, restaurant.id, { name: "Main" });
  const category = await createCategory(owner, restaurant.id, menu.id, { name: "Pizza" });
  const item = await createItem(owner, restaurant.id, {
    categoryId: category.id,
    name: "Margherita",
    priceMinor: 350000,
  });
  const group = await createModifierGroup(owner, restaurant.id, item.id, {
    name: "Size",
    minSelect: 1,
    maxSelect: 1,
  });
  const modifier = await createModifier(owner, restaurant.id, group.id, {
    name: "Large",
    priceDeltaMinor: 50000,
  });
  return { owner, restaurant, menu, category, item, group, modifier };
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).name),
  );

describe("menu tree", () => {
  it("returns the full sorted tree", async () => {
    const { owner, restaurant, menu, category } = await seed("a");
    await createItem(owner, restaurant.id, {
      categoryId: category.id,
      name: "Diavola",
      priceMinor: 400000,
    });

    const tree = await getMenuTree(owner, restaurant.id, menu.id);
    expect(tree.categories[0]?.items.map((i) => i.name)).toEqual(["Margherita", "Diavola"]);
    expect(tree.categories[0]?.items[0]?.modifierGroups[0]?.modifiers[0]).toMatchObject({
      name: "Large",
      priceDeltaMinor: 50000,
    });
  });
});

describe("tenant isolation", () => {
  it("treats every id from another restaurant as not found, even with your own restaurant id", async () => {
    const mine = await seed("mine");
    const theirs = await seed("theirs");
    const me = mine.owner;
    const r = mine.restaurant.id;

    // Lazy, so each attempt runs (and is awaited) one at a time.
    const attempts: [string, () => Promise<unknown>][] = [
      ["getMenuTree", () => getMenuTree(me, r, theirs.menu.id)],
      ["updateMenu", () => updateMenu(me, r, theirs.menu.id, { name: "x" })],
      ["deleteMenu", () => deleteMenu(me, r, theirs.menu.id)],
      ["createCategory", () => createCategory(me, r, theirs.menu.id, { name: "x" })],
      ["updateCategory", () => updateCategory(me, r, theirs.category.id, { name: "x" })],
      ["deleteCategory", () => deleteCategory(me, r, theirs.category.id)],
      [
        "createItem",
        () => createItem(me, r, { categoryId: theirs.category.id, name: "x", priceMinor: 1 }),
      ],
      ["updateItem", () => updateItem(me, r, theirs.item.id, { priceMinor: 1 })],
      ["moveItem", () => updateItem(me, r, mine.item.id, { categoryId: theirs.category.id })],
      ["deleteItem", () => deleteItem(me, r, theirs.item.id)],
      ["setItemAvailability", () => setItemAvailability(me, r, theirs.item.id, false)],
      [
        "createModifierGroup",
        () => createModifierGroup(me, r, theirs.item.id, { name: "x", minSelect: 0, maxSelect: 1 }),
      ],
      ["updateModifierGroup", () => updateModifierGroup(me, r, theirs.group.id, { name: "x" })],
      ["deleteModifierGroup", () => deleteModifierGroup(me, r, theirs.group.id)],
      ["createModifier", () => createModifier(me, r, theirs.group.id, { name: "x" })],
      ["updateModifier", () => updateModifier(me, r, theirs.modifier.id, { name: "x" })],
      ["deleteModifier", () => deleteModifier(me, r, theirs.modifier.id)],
      ["setModifierAvailability", () => setModifierAvailability(me, r, theirs.modifier.id, false)],
    ];
    for (const [name, attempt] of attempts) {
      expect([name, await codeOf(attempt())]).toEqual([name, "NOT_FOUND"]);
    }

    // Nothing of theirs changed.
    const tree = await getMenuTree(theirs.owner, theirs.restaurant.id, theirs.menu.id);
    expect(tree.categories[0]?.items[0]).toMatchObject({
      name: "Margherita",
      priceMinor: 350000,
      isAvailable: true,
    });
  });

  it("only attaches menus to the restaurant's own locations", async () => {
    const mine = await seed("mine");
    const theirs = await seed("theirs");
    const [theirLocation] = await db
      .insert(restaurantLocations)
      .values({
        restaurantId: theirs.restaurant.id,
        name: "T",
        slug: "t",
        addressLine: "1 St",
        city: "Yerevan",
      })
      .returning();
    const [myLocation] = await db
      .insert(restaurantLocations)
      .values({
        restaurantId: mine.restaurant.id,
        name: "M",
        slug: "m",
        addressLine: "2 St",
        city: "Yerevan",
      })
      .returning();

    expect(
      await codeOf(
        updateMenu(mine.owner, mine.restaurant.id, mine.menu.id, {
          locationIds: [theirLocation!.id],
        }),
      ),
    ).toBe("NOT_FOUND");
    await updateMenu(mine.owner, mine.restaurant.id, mine.menu.id, {
      locationIds: [myLocation!.id],
    });
    expect((await listMenus(mine.owner, mine.restaurant.id))[0]?.locationIds).toEqual([
      myLocation!.id,
    ]);
  });
});

describe("permissions", () => {
  it("lets managers edit, waiters read, and kitchen toggle availability only", async () => {
    const { restaurant, menu, item } = await seed("a");
    const manager = await addStaff(restaurant.id, "manager@example.am", "manager");
    const waiter = await addStaff(restaurant.id, "waiter@example.am", "waiter");
    const cook = await addStaff(restaurant.id, "cook@example.am", "kitchen");

    await expect(
      updateItem(manager, restaurant.id, item.id, { name: "Margherita DOP" }),
    ).resolves.toBeDefined();
    await expect(getMenuTree(waiter, restaurant.id, menu.id)).resolves.toBeDefined();
    expect(await codeOf(updateItem(waiter, restaurant.id, item.id, { name: "x" }))).toBe(
      "FORBIDDEN",
    );
    expect(await codeOf(setItemAvailability(waiter, restaurant.id, item.id, false))).toBe(
      "FORBIDDEN",
    );

    expect(await codeOf(updateItem(cook, restaurant.id, item.id, { priceMinor: 1 }))).toBe(
      "FORBIDDEN",
    );
    expect((await setItemAvailability(cook, restaurant.id, item.id, false)).isAvailable).toBe(
      false,
    );
  });
});

describe("rules", () => {
  it("validates input", async () => {
    const { owner, restaurant, category, group } = await seed("a");
    const base = { categoryId: category.id, name: "X" };
    expect(await codeOf(createItem(owner, restaurant.id, { ...base, priceMinor: -1 }))).toBe(
      "ZodError",
    );
    expect(await codeOf(createItem(owner, restaurant.id, { ...base, priceMinor: 1.5 }))).toBe(
      "ZodError",
    );
    expect(
      await codeOf(
        createItem(owner, restaurant.id, {
          ...base,
          priceMinor: 1,
          allergens: ["unicorn" as never],
        }),
      ),
    ).toBe("ZodError");
    // max below the existing min
    expect(
      await codeOf(updateModifierGroup(owner, restaurant.id, group.id, { maxSelect: 0 })),
    ).toBe("ZodError");
    await updateModifierGroup(owner, restaurant.id, group.id, { minSelect: 1, maxSelect: 3 });
    expect(
      await codeOf(updateModifierGroup(owner, restaurant.id, group.id, { minSelect: 4 })),
    ).toBe("VALIDATION_ERROR");
  });

  it("won't delete non-empty categories or menus", async () => {
    const { owner, restaurant, menu, category, item } = await seed("a");
    expect(await codeOf(deleteCategory(owner, restaurant.id, category.id))).toBe("CONFLICT");
    expect(await codeOf(deleteMenu(owner, restaurant.id, menu.id))).toBe("CONFLICT");

    await deleteItem(owner, restaurant.id, item.id);
    await deleteCategory(owner, restaurant.id, category.id);
    await deleteMenu(owner, restaurant.id, menu.id);
    expect(await listMenus(owner, restaurant.id)).toEqual([]);
  });

  it("reorders only the exact set of siblings", async () => {
    const { owner, restaurant, menu, category, item } = await seed("a");
    const second = await createItem(owner, restaurant.id, {
      categoryId: category.id,
      name: "Second",
      priceMinor: 1,
    });
    const other = await seed("b");

    await reorder(owner, restaurant.id, "items", category.id, [second.id, item.id]);
    expect(
      (await getMenuTree(owner, restaurant.id, menu.id)).categories[0]?.items.map((i) => i.name),
    ).toEqual(["Second", "Margherita"]);

    expect(await codeOf(reorder(owner, restaurant.id, "items", category.id, [item.id]))).toBe(
      "CONFLICT",
    );
    expect(
      await codeOf(reorder(owner, restaurant.id, "items", category.id, [item.id, other.item.id])),
    ).toBe("CONFLICT");
    expect(
      await codeOf(reorder(owner, restaurant.id, "items", other.category.id, [other.item.id])),
    ).toBe("CONFLICT");
  });

  it("audit-logs price changes but not other edits", async () => {
    const { owner, restaurant, item } = await seed("a");
    await updateItem(owner, restaurant.id, item.id, { description: "Classic" });
    await updateItem(owner, restaurant.id, item.id, { priceMinor: 380000 });

    const entries = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "menu_item.price_changed"));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata).toEqual({ name: "Margherita", from: 350000, to: 380000 });
    const [row] = await db.select().from(menuItems).where(eq(menuItems.id, item.id));
    expect(row).toMatchObject({ priceMinor: 380000, description: "Classic" });
  });
});
