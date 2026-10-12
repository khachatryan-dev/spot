import "server-only";

import { requireUser } from "@/server/auth/guards";
import { getRestaurantAccess } from "@/server/policies/restaurant-access";
import { getMenuTree } from "@/server/services/menu-service";
import { getRestaurant } from "@/server/services/restaurant-service";
import { roleHasPermission } from "@/shared/auth/permissions";

/** Shared data for the new/edit item pages. */
export async function loadItemEditor(restaurantId: string, menuId: string) {
  const user = await requireUser();
  const [tree, restaurant, access] = await Promise.all([
    getMenuTree(user, restaurantId, menuId),
    getRestaurant(user, restaurantId),
    getRestaurantAccess(user.id, restaurantId),
  ]);
  return {
    user,
    tree,
    currency: restaurant.currency,
    categories: tree.categories.map(({ id, name }) => ({ id, name })),
    canManage:
      !!access && roleHasPermission(access.role, "menu:manage") && restaurant.status !== "closed",
  };
}
