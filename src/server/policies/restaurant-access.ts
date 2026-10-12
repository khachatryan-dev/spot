import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/server/db/client";
import { restaurants, restaurantStaff } from "@/server/db/schema";
import {
  type PlatformPermission,
  platformRoleHasPermission,
  type RestaurantPermission,
  roleHasPermission,
} from "@/shared/auth/permissions";
import type { RestaurantStatus } from "@/shared/constants/restaurants";
import type { PlatformRole, RestaurantRole } from "@/shared/constants/roles";
import { AppError } from "@/shared/errors";

export interface RestaurantAccess {
  restaurantId: string;
  restaurantStatus: RestaurantStatus;
  role: RestaurantRole;
}

const uuid = z.uuid();

/** The user's active staff membership at a restaurant, or null. */
export async function getRestaurantAccess(
  userId: string,
  restaurantId: string,
): Promise<RestaurantAccess | null> {
  // Restaurant ids come from URLs and request bodies; reject junk before it reaches SQL.
  if (!uuid.safeParse(restaurantId).success) return null;

  const [row] = await db
    .select({
      restaurantId: restaurantStaff.restaurantId,
      restaurantStatus: restaurants.status,
      role: restaurantStaff.role,
    })
    .from(restaurantStaff)
    .innerJoin(restaurants, eq(restaurants.id, restaurantStaff.restaurantId))
    .where(
      and(
        eq(restaurantStaff.userId, userId),
        eq(restaurantStaff.restaurantId, restaurantId),
        eq(restaurantStaff.status, "active"),
      ),
    );
  return row ?? null;
}

/**
 * Tenant isolation + RBAC for restaurant resources (§8, §9, §49 #1, #13).
 *
 * - Not a member (or disabled) → NOT_FOUND, so other tenants' ids aren't confirmed.
 * - Member without the permission → FORBIDDEN.
 *
 * Platform admins get no implicit access to a restaurant's internal data.
 */
export async function authorizeRestaurant(
  userId: string,
  restaurantId: string,
  permission: RestaurantPermission,
): Promise<RestaurantAccess> {
  const access = await getRestaurantAccess(userId, restaurantId);
  if (!access) throw new AppError("NOT_FOUND", "Restaurant not found.");
  if (!roleHasPermission(access.role, permission)) throw new AppError("FORBIDDEN");
  return access;
}

/** Platform-level RBAC for admin features. */
export function authorizePlatform(
  user: { platformRole: PlatformRole },
  permission: PlatformPermission,
): void {
  if (!platformRoleHasPermission(user.platformRole, permission)) {
    throw new AppError("FORBIDDEN");
  }
}
