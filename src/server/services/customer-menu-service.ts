import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  menuCategories,
  menuItems,
  menuLocations,
  menus,
  modifierGroups,
  modifiers,
  restaurantLocations,
  type Translations,
} from "@/server/db/schema";
import type { Allergen, DietaryTag } from "@/shared/constants/menu";
import {
  isMenuAvailable,
  itemUnavailableReason,
  type ItemUnavailableReason,
} from "@/shared/domain/availability";
import { imageUrl } from "@/shared/utils/image-url";

/*
 * What guests see at a table (§15, §35). Read-only and public for one
 * location: inactive menus, hidden categories and hidden items never leave
 * the server. Availability uses the same rules order validation will use.
 */

export interface CustomerMenuItem {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  imageUrl: string | null;
  allergens: Allergen[];
  dietaryTags: DietaryTag[];
  hasOptions: boolean;
  modifierGroups: {
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    modifiers: {
      id: string;
      name: string;
      priceDeltaMinor: number;
      isAvailable: boolean;
      isDefault: boolean;
    }[];
  }[];
  /** null = can be ordered now. */
  unavailable: Exclude<ItemUnavailableReason, "hidden"> | null;
}

export interface CustomerMenu {
  id: string;
  name: string;
  categories: { id: string; name: string; description: string | null; items: CustomerMenuItem[] }[];
}

const localized = <
  T extends { name: string; description?: string | null; translations: Translations },
>(
  row: T,
  locale: string,
) => {
  const translation = row.translations[locale as keyof Translations];
  return {
    name: translation?.name?.trim() || row.name,
    description: translation?.description?.trim() || row.description || null,
  };
};

/**
 * Pass as `locale` to get the restaurant's own names (no translation) — used
 * for order snapshots, so the kitchen sees what the owner typed.
 */
export const ORIGINAL_LANGUAGE = "original";

/**
 * Menus served at a location, ready to render. By default only those served
 * at `at` (the table menu); `anyTime` lists every active menu (the public
 * restaurant page, which shows the menu whatever the hour).
 */
export async function getCustomerMenus(
  restaurantId: string,
  locationId: string,
  locale: string,
  at = new Date(),
  anyTime = false,
): Promise<CustomerMenu[]> {
  const [location] = await db
    .select({
      openingHours: restaurantLocations.openingHours,
      timezone: restaurantLocations.timezone,
      status: restaurantLocations.status,
    })
    .from(restaurantLocations)
    .where(
      and(
        eq(restaurantLocations.id, locationId),
        eq(restaurantLocations.restaurantId, restaurantId),
      ),
    );
  if (!location) return [];

  const served = (
    await db
      .select({
        id: menus.id,
        name: menus.name,
        description: menus.description,
        translations: menus.translations,
        isActive: menus.isActive,
        availableHours: menus.availableHours,
      })
      .from(menus)
      .innerJoin(
        menuLocations,
        and(eq(menuLocations.menuId, menus.id), eq(menuLocations.locationId, locationId)),
      )
      .where(and(eq(menus.restaurantId, restaurantId), eq(menus.isActive, true)))
      .orderBy(asc(menus.sortOrder), asc(menus.createdAt))
  ).filter((menu) =>
    anyTime ? location.status === "active" : isMenuAvailable({ location, menu, at }),
  );
  if (served.length === 0) return [];

  const categories = await db
    .select()
    .from(menuCategories)
    .where(
      and(
        eq(menuCategories.restaurantId, restaurantId),
        inArray(
          menuCategories.menuId,
          served.map((m) => m.id),
        ),
        eq(menuCategories.isActive, true),
      ),
    )
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.createdAt));
  const categoryIds = categories.map((c) => c.id);
  const items = categoryIds.length
    ? await db
        .select()
        .from(menuItems)
        .where(
          and(
            eq(menuItems.restaurantId, restaurantId),
            inArray(menuItems.categoryId, categoryIds),
            eq(menuItems.isActive, true),
          ),
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

  return (
    served
      .map((menu) => ({
        id: menu.id,
        name: localized(menu, locale).name,
        categories: categories
          .filter((category) => category.menuId === menu.id)
          .map((category) => ({
            id: category.id,
            ...localized(category, locale),
            items: items
              .filter((item) => item.categoryId === category.id)
              .map((item) => {
                const itemGroups = groups
                  .filter((g) => g.itemId === item.id)
                  .map((g) => ({
                    id: g.id,
                    name: localized(g, locale).name,
                    minSelect: g.minSelect,
                    maxSelect: g.maxSelect,
                    modifiers: mods
                      .filter((m) => m.groupId === g.id)
                      .map((m) => ({
                        id: m.id,
                        name: localized(m, locale).name,
                        priceDeltaMinor: m.priceDeltaMinor,
                        isAvailable: m.isAvailable,
                        isDefault: m.isDefault,
                      })),
                  }));
                const reason = itemUnavailableReason({
                  category,
                  item,
                  modifierGroups: itemGroups,
                });
                return {
                  id: item.id,
                  ...localized(item, locale),
                  priceMinor: item.priceMinor,
                  imageUrl: imageUrl(item.imageKey),
                  allergens: item.allergens,
                  dietaryTags: item.dietaryTags,
                  hasOptions: itemGroups.length > 0,
                  modifierGroups: itemGroups,
                  unavailable: reason === "hidden" ? null : reason,
                };
              }),
          }))
          .filter((category) => category.items.length > 0),
      }))
      // A menu with nothing visible would render as a blank page.
      .filter((menu) => menu.categories.length > 0)
  );
}
