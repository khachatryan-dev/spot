import "server-only";

import { getCustomerMenus, ORIGINAL_LANGUAGE } from "@/server/services/customer-menu-service";
import { orderRequestSchema, type OrderRequest } from "@/shared/schemas/order";

import { type Catalog, type PricedOrder, priceOrder } from "./pricing";

/**
 * What can be ordered at a location right now, priced from the database.
 * Built from the same function that renders the guest menu, so the server
 * accepts exactly what guests are shown (§15, §16).
 */
export async function loadOrderCatalog(
  restaurantId: string,
  locationId: string,
  at = new Date(),
): Promise<Catalog> {
  const menus = await getCustomerMenus(restaurantId, locationId, ORIGINAL_LANGUAGE, at);
  return new Map(
    menus.flatMap((menu) =>
      menu.categories.flatMap((category) =>
        category.items.map((item) => [
          item.id,
          {
            id: item.id,
            name: item.name,
            priceMinor: item.priceMinor,
            unavailable: item.unavailable,
            modifierGroups: item.modifierGroups,
          },
        ]),
      ),
    ),
  );
}

/** Validate a raw request and price it against the live catalog (throws on problems). */
export async function priceOrderRequest(
  restaurantId: string,
  locationId: string,
  input: OrderRequest,
  at = new Date(),
): Promise<{ request: ReturnType<typeof orderRequestSchema.parse>; priced: PricedOrder }> {
  const request = orderRequestSchema.parse(input);
  const priced = priceOrder(request, await loadOrderCatalog(restaurantId, locationId, at));
  return { request, priced };
}
