import "server-only";

import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db, type Executor } from "@/server/db/client";
import {
  type Menu,
  type MenuCategory,
  menuCategories,
  type MenuItem,
  menuItems,
  menuLocations,
  menus,
  type Modifier,
  type ModifierGroup,
  modifierGroups,
  modifiers,
  restaurantLocations,
} from "@/server/db/schema";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import type { RestaurantPermission } from "@/shared/auth/permissions";
import { AppError } from "@/shared/errors";
import {
  type CategoryInput,
  categorySchema,
  categoryUpdateSchema,
  type ItemInput,
  itemSchema,
  itemUpdateSchema,
  type MenuInput,
  menuSchema,
  menuUpdateSchema,
  type ModifierGroupInput,
  modifierGroupSchema,
  modifierGroupUpdateSchema,
  type ModifierInput,
  modifierSchema,
  modifierUpdateSchema,
} from "@/shared/schemas/menu";

/*
 * Menu management (§15). Every function authorizes the actor for this
 * restaurant, and every query filters by restaurant_id as well as the row id —
 * on top of the composite foreign keys in the schema.
 */

type Actor = Pick<SessionUser, "id">;

const isUuid = (value: string) => z.uuid().safeParse(value).success;

async function authorize(actor: Actor, restaurantId: string, permission: RestaurantPermission) {
  const access = await authorizeRestaurant(actor.id, restaurantId, permission);
  if (permission !== "menu:read" && access.restaurantStatus === "closed") {
    throw new AppError("CONFLICT", "A closed restaurant can't be edited.");
  }
}

const notFound = (what: string) => new AppError("NOT_FOUND", `${what} not found.`);

/** Fetch a row by id within this restaurant, or throw NOT_FOUND. */
async function findScoped<T>(
  executor: Executor,
  table:
    | typeof menus
    | typeof menuCategories
    | typeof menuItems
    | typeof modifierGroups
    | typeof modifiers,
  restaurantId: string,
  id: string,
  what: string,
): Promise<T> {
  if (!isUuid(id)) throw notFound(what);
  const [row] = await executor
    .select()
    .from(table)
    .where(and(eq(table.id, id), eq(table.restaurantId, restaurantId)));
  if (!row) throw notFound(what);
  return row as T;
}

/** Next sort position among siblings, so new rows go to the end. */
async function nextSortOrder(
  table:
    | typeof menus
    | typeof menuCategories
    | typeof menuItems
    | typeof modifierGroups
    | typeof modifiers,
  parent: ReturnType<typeof eq>,
) {
  const [row] = await db.select({ value: count() }).from(table).where(parent);
  return row?.value ?? 0;
}

/** Replace the set of locations serving a menu; every location must belong to this restaurant. */
async function setMenuLocations(
  tx: Executor,
  restaurantId: string,
  menuId: string,
  locationIds: string[],
) {
  if (locationIds.length > 0) {
    const owned = await tx
      .select({ id: restaurantLocations.id })
      .from(restaurantLocations)
      .where(
        and(
          eq(restaurantLocations.restaurantId, restaurantId),
          inArray(restaurantLocations.id, locationIds),
        ),
      );
    if (owned.length !== locationIds.length) throw notFound("Location");
  }
  await tx.delete(menuLocations).where(eq(menuLocations.menuId, menuId));
  if (locationIds.length > 0) {
    await tx
      .insert(menuLocations)
      .values(locationIds.map((locationId) => ({ menuId, locationId, restaurantId })));
  }
}

// ---------------------------------------------------------------- menus

export interface MenuSummary extends Menu {
  locationIds: string[];
}

export async function listMenus(actor: Actor, restaurantId: string): Promise<MenuSummary[]> {
  await authorize(actor, restaurantId, "menu:read");
  const [rows, links] = await Promise.all([
    db
      .select()
      .from(menus)
      .where(eq(menus.restaurantId, restaurantId))
      .orderBy(asc(menus.sortOrder), asc(menus.createdAt)),
    db.select().from(menuLocations).where(eq(menuLocations.restaurantId, restaurantId)),
  ]);
  return rows.map((menu) => ({
    ...menu,
    locationIds: links.filter((l) => l.menuId === menu.id).map((l) => l.locationId),
  }));
}

export async function createMenu(
  actor: Actor,
  restaurantId: string,
  input: MenuInput,
): Promise<Menu> {
  await authorize(actor, restaurantId, "menu:manage");
  const { locationIds, ...data } = menuSchema.parse(input);
  const sortOrder = await nextSortOrder(menus, eq(menus.restaurantId, restaurantId));
  return db.transaction(async (tx) => {
    const [menu] = await tx
      .insert(menus)
      .values({ ...data, restaurantId, sortOrder })
      .returning();
    if (!menu) throw new Error("Failed to create menu");
    if (locationIds) await setMenuLocations(tx, restaurantId, menu.id, locationIds);
    return menu;
  });
}

export async function updateMenu(
  actor: Actor,
  restaurantId: string,
  menuId: string,
  input: Partial<MenuInput>,
) {
  await authorize(actor, restaurantId, "menu:manage");
  await findScoped<Menu>(db, menus, restaurantId, menuId, "Menu");
  const { locationIds, ...data } = menuUpdateSchema.parse(input);
  return db.transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx
        .update(menus)
        .set(data)
        .where(and(eq(menus.id, menuId), eq(menus.restaurantId, restaurantId)));
    }
    if (locationIds) await setMenuLocations(tx, restaurantId, menuId, locationIds);
    return findScoped<Menu>(tx, menus, restaurantId, menuId, "Menu");
  });
}

/** Only empty menus can be deleted; deactivate a menu instead to hide it. */
export async function deleteMenu(actor: Actor, restaurantId: string, menuId: string) {
  await authorize(actor, restaurantId, "menu:manage");
  await findScoped<Menu>(db, menus, restaurantId, menuId, "Menu");
  const [{ value } = { value: 0 }] = await db
    .select({ value: count() })
    .from(menuCategories)
    .where(eq(menuCategories.menuId, menuId));
  if (value > 0) throw new AppError("CONFLICT", "Remove the menu's categories first.");
  await db.delete(menus).where(and(eq(menus.id, menuId), eq(menus.restaurantId, restaurantId)));
}

// ---------------------------------------------------------------- full tree

export interface MenuTree extends Menu {
  categories: (MenuCategory & {
    items: (MenuItem & { modifierGroups: (ModifierGroup & { modifiers: Modifier[] })[] })[];
  })[];
}

/** The whole menu, sorted, for the editor. */
export async function getMenuTree(
  actor: Actor,
  restaurantId: string,
  menuId: string,
): Promise<MenuTree> {
  await authorize(actor, restaurantId, "menu:read");
  const menu = await findScoped<Menu>(db, menus, restaurantId, menuId, "Menu");

  const categories = await db
    .select()
    .from(menuCategories)
    .where(and(eq(menuCategories.menuId, menuId), eq(menuCategories.restaurantId, restaurantId)))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.createdAt));
  const categoryIds = categories.map((c) => c.id);
  const items = categoryIds.length
    ? await db
        .select()
        .from(menuItems)
        .where(
          and(eq(menuItems.restaurantId, restaurantId), inArray(menuItems.categoryId, categoryIds)),
        )
        .orderBy(asc(menuItems.sortOrder), asc(menuItems.createdAt))
    : [];
  const itemIds = items.map((i) => i.id);
  const groups = itemIds.length
    ? await db
        .select()
        .from(modifierGroups)
        .where(
          and(
            eq(modifierGroups.restaurantId, restaurantId),
            inArray(modifierGroups.itemId, itemIds),
          ),
        )
        .orderBy(asc(modifierGroups.sortOrder), asc(modifierGroups.createdAt))
    : [];
  const groupIds = groups.map((g) => g.id);
  const mods = groupIds.length
    ? await db
        .select()
        .from(modifiers)
        .where(and(eq(modifiers.restaurantId, restaurantId), inArray(modifiers.groupId, groupIds)))
        .orderBy(asc(modifiers.sortOrder), asc(modifiers.createdAt))
    : [];

  return {
    ...menu,
    categories: categories.map((category) => ({
      ...category,
      items: items
        .filter((item) => item.categoryId === category.id)
        .map((item) => ({
          ...item,
          modifierGroups: groups
            .filter((group) => group.itemId === item.id)
            .map((group) => ({ ...group, modifiers: mods.filter((m) => m.groupId === group.id) })),
        })),
    })),
  };
}

// ---------------------------------------------------------------- categories

export async function createCategory(
  actor: Actor,
  restaurantId: string,
  menuId: string,
  input: CategoryInput,
) {
  await authorize(actor, restaurantId, "menu:manage");
  await findScoped<Menu>(db, menus, restaurantId, menuId, "Menu");
  const data = categorySchema.parse(input);
  const sortOrder = await nextSortOrder(menuCategories, eq(menuCategories.menuId, menuId));
  const [category] = await db
    .insert(menuCategories)
    .values({ ...data, restaurantId, menuId, sortOrder })
    .returning();
  return category!;
}

export async function updateCategory(
  actor: Actor,
  restaurantId: string,
  categoryId: string,
  input: Partial<CategoryInput>,
) {
  await authorize(actor, restaurantId, "menu:manage");
  const current = await findScoped<MenuCategory>(
    db,
    menuCategories,
    restaurantId,
    categoryId,
    "Category",
  );
  const data = categoryUpdateSchema.parse(input);
  if (Object.keys(data).length === 0) return current;
  const [updated] = await db
    .update(menuCategories)
    .set(data)
    .where(and(eq(menuCategories.id, categoryId), eq(menuCategories.restaurantId, restaurantId)))
    .returning();
  return updated!;
}

/** Only empty categories can be deleted — so a click can't wipe out items by accident. */
export async function deleteCategory(actor: Actor, restaurantId: string, categoryId: string) {
  await authorize(actor, restaurantId, "menu:manage");
  await findScoped<MenuCategory>(db, menuCategories, restaurantId, categoryId, "Category");
  const [{ value } = { value: 0 }] = await db
    .select({ value: count() })
    .from(menuItems)
    .where(eq(menuItems.categoryId, categoryId));
  if (value > 0) throw new AppError("CONFLICT", "Move or delete the category's items first.");
  await db
    .delete(menuCategories)
    .where(and(eq(menuCategories.id, categoryId), eq(menuCategories.restaurantId, restaurantId)));
}

// ---------------------------------------------------------------- items

export async function createItem(actor: Actor, restaurantId: string, input: ItemInput) {
  await authorize(actor, restaurantId, "menu:manage");
  const data = itemSchema.parse(input);
  await findScoped<MenuCategory>(db, menuCategories, restaurantId, data.categoryId, "Category");
  const sortOrder = await nextSortOrder(menuItems, eq(menuItems.categoryId, data.categoryId));
  const [item] = await db
    .insert(menuItems)
    .values({ ...data, restaurantId, sortOrder })
    .returning();
  return item!;
}

export async function updateItem(
  actor: Actor,
  restaurantId: string,
  itemId: string,
  input: Partial<ItemInput>,
) {
  await authorize(actor, restaurantId, "menu:manage");
  const current = await findScoped<MenuItem>(db, menuItems, restaurantId, itemId, "Item");
  const data = itemUpdateSchema.parse(input);
  if (Object.keys(data).length === 0) return current;
  if (data.categoryId && data.categoryId !== current.categoryId) {
    await findScoped<MenuCategory>(db, menuCategories, restaurantId, data.categoryId, "Category");
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(menuItems)
      .set(data)
      .where(and(eq(menuItems.id, itemId), eq(menuItems.restaurantId, restaurantId)))
      .returning();
    if (data.priceMinor !== undefined && data.priceMinor !== current.priceMinor) {
      await recordAudit(tx, {
        actor,
        action: "menu_item.price_changed",
        entityType: "menu_item",
        entityId: itemId,
        restaurantId,
        metadata: { name: current.name, from: current.priceMinor, to: data.priceMinor },
      });
    }
    return updated!;
  });
}

/** One item, for its editor. */
export async function getItem(
  actor: Actor,
  restaurantId: string,
  itemId: string,
): Promise<MenuItem> {
  await authorize(actor, restaurantId, "menu:read");
  return findScoped<MenuItem>(db, menuItems, restaurantId, itemId, "Item");
}

/** Set or clear an item's image key (called by the image service after upload). */
export async function setItemImageKey(
  actor: Actor,
  restaurantId: string,
  itemId: string,
  imageKey: string | null,
): Promise<{ previous: string | null }> {
  await authorize(actor, restaurantId, "menu:manage");
  const current = await findScoped<MenuItem>(db, menuItems, restaurantId, itemId, "Item");
  await db
    .update(menuItems)
    .set({ imageKey })
    .where(and(eq(menuItems.id, itemId), eq(menuItems.restaurantId, restaurantId)));
  return { previous: current.imageKey };
}

/** Past orders keep their own snapshots (§16), so deleting an item never changes history. */
export async function deleteItem(actor: Actor, restaurantId: string, itemId: string) {
  await authorize(actor, restaurantId, "menu:manage");
  await findScoped<MenuItem>(db, menuItems, restaurantId, itemId, "Item");
  await db
    .delete(menuItems)
    .where(and(eq(menuItems.id, itemId), eq(menuItems.restaurantId, restaurantId)));
}

/** In-stock toggle for service; kitchen staff may use it (menu:availability). */
export async function setItemAvailability(
  actor: Actor,
  restaurantId: string,
  itemId: string,
  isAvailable: boolean,
) {
  await authorize(actor, restaurantId, "menu:availability");
  await findScoped<MenuItem>(db, menuItems, restaurantId, itemId, "Item");
  const [updated] = await db
    .update(menuItems)
    .set({ isAvailable: z.boolean().parse(isAvailable) })
    .where(and(eq(menuItems.id, itemId), eq(menuItems.restaurantId, restaurantId)))
    .returning();
  return updated!;
}

// ---------------------------------------------------------------- modifiers

export async function createModifierGroup(
  actor: Actor,
  restaurantId: string,
  itemId: string,
  input: ModifierGroupInput,
) {
  await authorize(actor, restaurantId, "menu:manage");
  await findScoped<MenuItem>(db, menuItems, restaurantId, itemId, "Item");
  const data = modifierGroupSchema.parse(input);
  const sortOrder = await nextSortOrder(modifierGroups, eq(modifierGroups.itemId, itemId));
  const [group] = await db
    .insert(modifierGroups)
    .values({ ...data, restaurantId, itemId, sortOrder })
    .returning();
  return group!;
}

export async function updateModifierGroup(
  actor: Actor,
  restaurantId: string,
  groupId: string,
  input: Partial<ModifierGroupInput>,
) {
  await authorize(actor, restaurantId, "menu:manage");
  const current = await findScoped<ModifierGroup>(
    db,
    modifierGroups,
    restaurantId,
    groupId,
    "Modifier group",
  );
  const data = modifierGroupUpdateSchema.parse(input);
  const merged = {
    minSelect: data.minSelect ?? current.minSelect,
    maxSelect: data.maxSelect ?? current.maxSelect,
  };
  if (merged.maxSelect < merged.minSelect) {
    throw new AppError("VALIDATION_ERROR", "Maximum can't be below minimum.", {
      fieldErrors: { maxSelect: ["maxBelowMin"] },
    });
  }
  if (Object.keys(data).length === 0) return current;
  const [updated] = await db
    .update(modifierGroups)
    .set(data)
    .where(and(eq(modifierGroups.id, groupId), eq(modifierGroups.restaurantId, restaurantId)))
    .returning();
  return updated!;
}

export async function deleteModifierGroup(actor: Actor, restaurantId: string, groupId: string) {
  await authorize(actor, restaurantId, "menu:manage");
  await findScoped<ModifierGroup>(db, modifierGroups, restaurantId, groupId, "Modifier group");
  await db
    .delete(modifierGroups)
    .where(and(eq(modifierGroups.id, groupId), eq(modifierGroups.restaurantId, restaurantId)));
}

export async function createModifier(
  actor: Actor,
  restaurantId: string,
  groupId: string,
  input: ModifierInput,
) {
  await authorize(actor, restaurantId, "menu:manage");
  await findScoped<ModifierGroup>(db, modifierGroups, restaurantId, groupId, "Modifier group");
  const data = modifierSchema.parse(input);
  const sortOrder = await nextSortOrder(modifiers, eq(modifiers.groupId, groupId));
  const [modifier] = await db
    .insert(modifiers)
    .values({ ...data, restaurantId, groupId, sortOrder })
    .returning();
  return modifier!;
}

export async function updateModifier(
  actor: Actor,
  restaurantId: string,
  modifierId: string,
  input: Partial<ModifierInput>,
) {
  await authorize(actor, restaurantId, "menu:manage");
  const current = await findScoped<Modifier>(db, modifiers, restaurantId, modifierId, "Modifier");
  const data = modifierUpdateSchema.parse(input);
  if (Object.keys(data).length === 0) return current;
  const [updated] = await db
    .update(modifiers)
    .set(data)
    .where(and(eq(modifiers.id, modifierId), eq(modifiers.restaurantId, restaurantId)))
    .returning();
  return updated!;
}

export async function deleteModifier(actor: Actor, restaurantId: string, modifierId: string) {
  await authorize(actor, restaurantId, "menu:manage");
  await findScoped<Modifier>(db, modifiers, restaurantId, modifierId, "Modifier");
  await db
    .delete(modifiers)
    .where(and(eq(modifiers.id, modifierId), eq(modifiers.restaurantId, restaurantId)));
}

export async function setModifierAvailability(
  actor: Actor,
  restaurantId: string,
  modifierId: string,
  isAvailable: boolean,
) {
  await authorize(actor, restaurantId, "menu:availability");
  await findScoped<Modifier>(db, modifiers, restaurantId, modifierId, "Modifier");
  const [updated] = await db
    .update(modifiers)
    .set({ isAvailable: z.boolean().parse(isAvailable) })
    .where(and(eq(modifiers.id, modifierId), eq(modifiers.restaurantId, restaurantId)))
    .returning();
  return updated!;
}

// ---------------------------------------------------------------- ordering

const SIBLINGS = {
  categories: { table: menuCategories, parent: menuCategories.menuId },
  items: { table: menuItems, parent: menuItems.categoryId },
  modifierGroups: { table: modifierGroups, parent: modifierGroups.itemId },
  modifiers: { table: modifiers, parent: modifiers.groupId },
} as const;

/**
 * Reorder siblings (categories in a menu, items in a category, …). `orderedIds`
 * must be exactly the current siblings — no more, no fewer, no strangers.
 */
export async function reorder(
  actor: Actor,
  restaurantId: string,
  kind: keyof typeof SIBLINGS,
  parentId: string,
  orderedIds: string[],
) {
  await authorize(actor, restaurantId, "menu:manage");
  const { table, parent } = SIBLINGS[kind];
  const ids = z.array(z.uuid()).max(500).parse(orderedIds);
  if (!isUuid(parentId)) throw notFound("Parent");

  await db.transaction(async (tx) => {
    const siblings = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(parent, parentId), eq(table.restaurantId, restaurantId)));
    const current = new Set(siblings.map((s) => s.id));
    if (
      siblings.length === 0 ||
      ids.length !== current.size ||
      !ids.every((id) => current.has(id))
    ) {
      throw new AppError("CONFLICT", "The list changed. Please reload and try again.");
    }
    for (const [index, id] of ids.entries()) {
      await tx
        .update(table)
        .set({ sortOrder: index })
        .where(and(eq(table.id, id), eq(table.restaurantId, restaurantId)));
    }
  });
}
