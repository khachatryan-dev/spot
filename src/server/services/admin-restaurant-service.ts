import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import {
  type Restaurant,
  restaurantLocations,
  restaurants,
  restaurantStaff,
  users,
} from "@/server/db/schema";
import { authorizePlatform } from "@/server/policies/restaurant-access";
import * as repo from "@/server/repositories/restaurant-repository";
import type { AuditAction } from "@/shared/constants/audit";
import type { RestaurantStatus } from "@/shared/constants/restaurants";
import { canTransition } from "@/shared/domain/restaurant-status";
import { AppError } from "@/shared/errors";
import { statusReasonSchema, type StatusReasonInput } from "@/shared/schemas/admin";

/*
 * Platform administration of restaurants (§10, §12 admin). Admins see review
 * data (profile, locations, owners) — never a restaurant's orders or customers.
 */

type Admin = Pick<SessionUser, "id" | "platformRole">;

export async function listRestaurantsForAdmin(
  admin: Admin,
  status: RestaurantStatus = "pending_review",
) {
  authorizePlatform(admin, "platform:restaurants:review");
  return (
    db
      .select({
        id: restaurants.id,
        name: restaurants.name,
        slug: restaurants.slug,
        status: restaurants.status,
        submittedAt: restaurants.submittedAt,
        createdAt: restaurants.createdAt,
      })
      .from(restaurants)
      .where(eq(restaurants.status, status))
      // Oldest submissions first, so nobody waits forever.
      .orderBy(
        status === "pending_review" ? asc(restaurants.submittedAt) : desc(restaurants.updatedAt),
      )
      .limit(200)
  );
}

export async function getRestaurantForReview(admin: Admin, restaurantId: string) {
  authorizePlatform(admin, "platform:restaurants:review");
  if (!z.uuid().safeParse(restaurantId).success) throw new AppError("NOT_FOUND");
  const restaurant = await repo.findRestaurantById(restaurantId);
  if (!restaurant) throw new AppError("NOT_FOUND", "Restaurant not found.");

  const [locations, owners] = await Promise.all([
    db
      .select({
        id: restaurantLocations.id,
        name: restaurantLocations.name,
        addressLine: restaurantLocations.addressLine,
        city: restaurantLocations.city,
        phone: restaurantLocations.phone,
        status: restaurantLocations.status,
      })
      .from(restaurantLocations)
      .where(eq(restaurantLocations.restaurantId, restaurantId))
      .orderBy(asc(restaurantLocations.createdAt)),
    db
      .select({ name: users.name, email: users.email })
      .from(restaurantStaff)
      .innerJoin(users, eq(users.id, restaurantStaff.userId))
      .where(
        and(
          eq(restaurantStaff.restaurantId, restaurantId),
          eq(restaurantStaff.role, "owner"),
          eq(restaurantStaff.status, "active"),
        ),
      ),
  ]);
  return { restaurant, locations, owners };
}

async function transition(
  admin: Admin,
  restaurantId: string,
  to: RestaurantStatus,
  action: AuditAction,
  extra: Partial<Pick<Restaurant, "approvedAt" | "statusReason">>,
): Promise<Restaurant> {
  authorizePlatform(admin, "platform:restaurants:manage");
  if (!z.uuid().safeParse(restaurantId).success) throw new AppError("NOT_FOUND");
  const current = await repo.findRestaurantById(restaurantId);
  if (!current) throw new AppError("NOT_FOUND", "Restaurant not found.");
  if (!canTransition(current.status, to, "platform_admin")) {
    throw new AppError("CONFLICT", `Can't change a ${current.status} restaurant to ${to}.`);
  }
  return db.transaction(async (tx) => {
    // Only succeeds if nobody changed the status in the meantime.
    const updated = await repo.transitionRestaurantStatus(
      restaurantId,
      current.status,
      to,
      extra,
      tx,
    );
    if (!updated) throw new AppError("CONFLICT", "The restaurant's status changed. Please reload.");
    await recordAudit(tx, {
      actor: admin,
      action,
      entityType: "restaurant",
      entityId: restaurantId,
      restaurantId,
      metadata: {
        from: current.status,
        to,
        ...(extra.statusReason ? { reason: extra.statusReason } : {}),
      },
    });
    return updated;
  });
}

/** pending_review → active: the restaurant becomes public. */
export async function approveRestaurant(admin: Admin, restaurantId: string) {
  return transition(admin, restaurantId, "active", "restaurant.approved", {
    approvedAt: new Date(),
    statusReason: null,
  });
}

/** pending_review → draft, with a reason the owner sees and can fix. */
export async function rejectRestaurant(
  admin: Admin,
  restaurantId: string,
  input: StatusReasonInput,
) {
  const { reason } = statusReasonSchema.parse(input);
  return transition(admin, restaurantId, "draft", "restaurant.rejected", { statusReason: reason });
}

/** active → suspended: hidden from the public, with a reason for the owner. */
export async function suspendRestaurant(
  admin: Admin,
  restaurantId: string,
  input: StatusReasonInput,
) {
  const { reason } = statusReasonSchema.parse(input);
  return transition(admin, restaurantId, "suspended", "restaurant.suspended", {
    statusReason: reason,
  });
}

/** suspended → active. */
export async function reinstateRestaurant(admin: Admin, restaurantId: string) {
  return transition(admin, restaurantId, "active", "restaurant.reinstated", { statusReason: null });
}
