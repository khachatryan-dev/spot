import { eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { restaurantLocations, restaurants, users } from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { createGuest } from "@/server/guests/guest-service";
import {
  createCategory,
  createItem,
  createMenu,
  createModifier,
  createModifierGroup,
} from "@/server/services/menu-service";
import { ensureTableQr, resolveQrToken } from "@/server/services/qr-service";
import { createRestaurant } from "@/server/services/restaurant-service";
import { createTable } from "@/server/services/table-service";
import { joinTableSession } from "@/server/services/table-session-service";

/*
 * Shared setup for ordering and billing integration tests: an active
 * restaurant, table 3 with an open visit, a pizza with sizes and a soup.
 */

export async function guest(): Promise<Customer> {
  return { type: "guest", guest: (await createGuest()).guest };
}

/** Active restaurant, table 3 with an open session, a pizza with sizes and a soup. */
export async function orderingSetup() {
  const [owner] = await db.insert(users).values({ email: "owner@example.am" }).returning();
  const restaurant = await createRestaurant(owner!, { name: "Order Cafe" });
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
  const table = await createTable(owner!, restaurant.id, { locationId: location!.id, number: "3" });
  const { token } = await ensureTableQr(owner!, restaurant.id, table.id);
  const menu = await createMenu(owner!, restaurant.id, {
    name: "Main",
    locationIds: [location!.id],
  });
  const category = await createCategory(owner!, restaurant.id, menu.id, { name: "Food" });
  const pizza = await createItem(owner!, restaurant.id, {
    categoryId: category.id,
    name: "Pizza",
    priceMinor: 350000,
  });
  const size = await createModifierGroup(owner!, restaurant.id, pizza.id, {
    name: "Size",
    minSelect: 1,
    maxSelect: 1,
  });
  const large = await createModifier(owner!, restaurant.id, size.id, {
    name: "Large",
    priceDeltaMinor: 50000,
  });
  const soup = await createItem(owner!, restaurant.id, {
    categoryId: category.id,
    name: "Soup",
    priceMinor: 200000,
  });
  const ani = await guest();
  const session = await joinTableSession(ani, (await resolveQrToken(token))!);
  return {
    owner: owner!,
    restaurantId: restaurant.id,
    locationId: location!.id,
    table,
    token,
    pizza,
    large,
    soup,
    ani,
    session,
  };
}

export type OrderingSetup = Awaited<ReturnType<typeof orderingSetup>>;
export const orderRequest = (s: OrderingSetup, key = "checkout-0001") => ({
  lines: [
    { itemId: s.pizza.id, modifierIds: [s.large.id], quantity: 2, note: "well done" },
    { itemId: s.soup.id, quantity: 1 },
  ],
  note: "Birthday!",
  idempotencyKey: key,
});
