import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { Locale } from "@/i18n/routing";
import type { OpeningHours } from "@/shared/schemas/opening-hours";
import {
  ALLERGENS,
  type Allergen,
  DIETARY_TAGS,
  type DietaryTag,
  MAX_PRICE_MINOR,
} from "@/shared/constants/menu";

import { timestamps } from "./_shared";
import { restaurantLocations, restaurants } from "./restaurants";

/**
 * Menu hierarchy (§15): Menu → Category → Item → Modifier group → Modifier.
 *
 * Every table carries `restaurant_id`, and child → parent foreign keys include
 * it, so the database itself guarantees a row can't hang under another
 * restaurant's menu (tenant isolation, §8).
 *
 * Prices are integers in the restaurant currency's minor units — never floats.
 * Order history keeps its own price snapshots (§16), so editing a menu never
 * changes past orders.
 */

/** Optional extra languages: `name` / `description` columns hold the default language. */
export type Translations = Partial<Record<Locale | "ru", { name?: string; description?: string }>>;

const translations = () => jsonb().$type<Translations>().notNull().default({});
const restaurantId = () =>
  uuid()
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" });
const arrayWithin = (column: unknown, values: readonly string[]) =>
  sql`${column} <@ ARRAY[${sql.raw(values.map((v) => `'${v}'`).join(","))}]::text[]`;

export const menus = pgTable(
  "menus",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: restaurantId(),
    name: text().notNull(),
    description: text(),
    translations: translations(),
    isActive: boolean().notNull().default(true),
    /** Own schedule (e.g. breakfast 08:00–12:00); null = whenever the location is open. */
    availableHours: jsonb().$type<OpeningHours>(),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("menus_id_restaurant_unique").on(t.id, t.restaurantId),
    index("menus_restaurant_idx").on(t.restaurantId),
  ],
);

/** Which locations serve which menu (a chain can share one menu across branches). */
export const menuLocations = pgTable(
  "menu_locations",
  {
    menuId: uuid().notNull(),
    locationId: uuid().notNull(),
    restaurantId: restaurantId(),
  },
  (t) => [
    primaryKey({ columns: [t.menuId, t.locationId] }),
    foreignKey({
      name: "menu_locations_menu_fk",
      columns: [t.menuId, t.restaurantId],
      foreignColumns: [menus.id, menus.restaurantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "menu_locations_location_fk",
      columns: [t.locationId, t.restaurantId],
      foreignColumns: [restaurantLocations.id, restaurantLocations.restaurantId],
    }).onDelete("cascade"),
    index("menu_locations_location_idx").on(t.locationId),
  ],
);

export const menuCategories = pgTable(
  "menu_categories",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: restaurantId(),
    menuId: uuid().notNull(),
    name: text().notNull(),
    description: text(),
    translations: translations(),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("menu_categories_id_restaurant_unique").on(t.id, t.restaurantId),
    foreignKey({
      name: "menu_categories_menu_fk",
      columns: [t.menuId, t.restaurantId],
      foreignColumns: [menus.id, menus.restaurantId],
    }).onDelete("cascade"),
    index("menu_categories_menu_idx").on(t.menuId, t.sortOrder),
  ],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: restaurantId(),
    categoryId: uuid().notNull(),
    name: text().notNull(),
    description: text(),
    translations: translations(),
    /** Price in minor units of the restaurant currency. */
    priceMinor: integer().notNull(),
    /** Object-storage key (§31). */
    imageKey: text(),
    ingredients: text(),
    allergens: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`)
      .$type<Allergen[]>(),
    dietaryTags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`)
      .$type<DietaryTag[]>(),
    prepTimeMinutes: smallint(),
    /** Shown on the menu at all. */
    isActive: boolean().notNull().default(true),
    /** In stock right now — staff toggle this during service (Day 28). */
    isAvailable: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("menu_items_id_restaurant_unique").on(t.id, t.restaurantId),
    foreignKey({
      name: "menu_items_category_fk",
      columns: [t.categoryId, t.restaurantId],
      foreignColumns: [menuCategories.id, menuCategories.restaurantId],
    }).onDelete("cascade"),
    index("menu_items_category_idx").on(t.categoryId, t.sortOrder),
    check(
      "menu_items_price_range",
      sql`${t.priceMinor} BETWEEN 0 AND ${sql.raw(String(MAX_PRICE_MINOR))}`,
    ),
    check(
      "menu_items_prep_time",
      sql`${t.prepTimeMinutes} IS NULL OR ${t.prepTimeMinutes} BETWEEN 0 AND 600`,
    ),
    check("menu_items_allergens_known", arrayWithin(t.allergens, ALLERGENS)),
    check("menu_items_dietary_known", arrayWithin(t.dietaryTags, DIETARY_TAGS)),
  ],
);

/**
 * A choice on an item, e.g. "Size" (pick exactly 1) or "Extras" (up to 3).
 * min_select ≥ 1 makes the group required.
 */
export const modifierGroups = pgTable(
  "modifier_groups",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: restaurantId(),
    itemId: uuid().notNull(),
    name: text().notNull(),
    translations: translations(),
    minSelect: smallint().notNull().default(0),
    maxSelect: smallint().notNull().default(1),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("modifier_groups_id_restaurant_unique").on(t.id, t.restaurantId),
    foreignKey({
      name: "modifier_groups_item_fk",
      columns: [t.itemId, t.restaurantId],
      foreignColumns: [menuItems.id, menuItems.restaurantId],
    }).onDelete("cascade"),
    index("modifier_groups_item_idx").on(t.itemId, t.sortOrder),
    check(
      "modifier_groups_selection",
      sql`${t.minSelect} >= 0 AND ${t.maxSelect} >= 1 AND ${t.maxSelect} >= ${t.minSelect}`,
    ),
  ],
);

export const modifiers = pgTable(
  "modifiers",
  {
    id: uuid().primaryKey().defaultRandom(),
    restaurantId: restaurantId(),
    groupId: uuid().notNull(),
    name: text().notNull(),
    translations: translations(),
    /** Added to the item price when chosen (minor units, never negative). */
    priceDeltaMinor: integer().notNull().default(0),
    isDefault: boolean().notNull().default(false),
    isAvailable: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "modifiers_group_fk",
      columns: [t.groupId, t.restaurantId],
      foreignColumns: [modifierGroups.id, modifierGroups.restaurantId],
    }).onDelete("cascade"),
    index("modifiers_group_idx").on(t.groupId, t.sortOrder),
    check(
      "modifiers_price_range",
      sql`${t.priceDeltaMinor} BETWEEN 0 AND ${sql.raw(String(MAX_PRICE_MINOR))}`,
    ),
  ],
);

export type Menu = typeof menus.$inferSelect;
export type MenuCategory = typeof menuCategories.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type ModifierGroup = typeof modifierGroups.$inferSelect;
export type Modifier = typeof modifiers.$inferSelect;
