import "server-only";

import { notFound, redirect } from "next/navigation";

import type { Locale } from "@/i18n/routing";
import { localizePath } from "@/i18n/paths";
import {
  authorizePlatform,
  authorizeRestaurant,
  type RestaurantAccess,
} from "@/server/policies/restaurant-access";
import type { PlatformPermission, RestaurantPermission } from "@/shared/auth/permissions";
import { AppError, isAppError } from "@/shared/errors";

import { getSession, type SessionUser } from "./session";

/*
 * Guards for Server Actions, Route Handlers and services. They throw
 * AppError (UNAUTHORIZED / FORBIDDEN / NOT_FOUND), which `route()` and
 * `action()` turn into safe responses. Every data access must go through
 * one of these — layout checks alone are not enough.
 */

/** The signed-in, active user, or UNAUTHORIZED. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AppError("UNAUTHORIZED");
  return session.user;
}

/** Signed-in user who holds `permission` at this restaurant (§8, §9). */
export async function requireRestaurantRole(
  restaurantId: string,
  permission: RestaurantPermission,
): Promise<{ user: SessionUser; access: RestaurantAccess }> {
  const user = await requireUser();
  const access = await authorizeRestaurant(user.id, restaurantId, permission);
  return { user, access };
}

/** Signed-in user with a platform permission (admin features). */
export async function requirePlatformPermission(
  permission: PlatformPermission,
): Promise<SessionUser> {
  const user = await requireUser();
  authorizePlatform(user, permission);
  return user;
}

/**
 * Run a guard inside a page or layout: not signed in → login page;
 * not allowed → 404 (doesn't reveal that the page or resource exists).
 */
export async function guardPage<T>(locale: Locale, guard: () => Promise<T>): Promise<T> {
  try {
    return await guard();
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (error.code === "UNAUTHORIZED") redirect(localizePath("/login", locale));
    if (error.code === "FORBIDDEN" || error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
