"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import {
  createCategory,
  createItem,
  createMenu,
  deleteCategory,
  deleteItem,
  reorder,
  updateCategory,
  updateItem,
  updateMenu,
} from "@/server/services/menu-service";
import type { CategoryInput, ItemInput, MenuInput } from "@/shared/schemas/menu";

// Thin wrappers: the menu service validates input and checks access.

export async function createMenuAction(restaurantId: string, input: MenuInput) {
  return action(async () => {
    const menu = await createMenu(await requireUser(), restaurantId, input);
    return { id: menu.id };
  });
}

export async function updateMenuAction(
  restaurantId: string,
  menuId: string,
  input: Partial<MenuInput>,
) {
  return action(async () => {
    await updateMenu(await requireUser(), restaurantId, menuId, input);
    return { ok: true };
  });
}

export async function createCategoryAction(
  restaurantId: string,
  menuId: string,
  input: CategoryInput,
) {
  return action(async () => {
    const category = await createCategory(await requireUser(), restaurantId, menuId, input);
    return { id: category.id };
  });
}

export async function updateCategoryAction(
  restaurantId: string,
  categoryId: string,
  input: Partial<CategoryInput>,
) {
  return action(async () => {
    await updateCategory(await requireUser(), restaurantId, categoryId, input);
    return { ok: true };
  });
}

export async function deleteCategoryAction(restaurantId: string, categoryId: string) {
  return action(async () => {
    await deleteCategory(await requireUser(), restaurantId, categoryId);
    return { ok: true };
  });
}

export async function reorderCategoriesAction(
  restaurantId: string,
  menuId: string,
  orderedIds: string[],
) {
  return action(async () => {
    await reorder(await requireUser(), restaurantId, "categories", menuId, orderedIds);
    return { ok: true };
  });
}

export async function createItemAction(restaurantId: string, input: ItemInput) {
  return action(async () => {
    const item = await createItem(await requireUser(), restaurantId, input);
    return { id: item.id };
  });
}

export async function updateItemAction(
  restaurantId: string,
  itemId: string,
  input: Partial<ItemInput>,
) {
  return action(async () => {
    await updateItem(await requireUser(), restaurantId, itemId, input);
    return { ok: true };
  });
}

export async function deleteItemAction(restaurantId: string, itemId: string) {
  return action(async () => {
    await deleteItem(await requireUser(), restaurantId, itemId);
    return { ok: true };
  });
}

export async function reorderItemsAction(
  restaurantId: string,
  categoryId: string,
  orderedIds: string[],
) {
  return action(async () => {
    await reorder(await requireUser(), restaurantId, "items", categoryId, orderedIds);
    return { ok: true };
  });
}
