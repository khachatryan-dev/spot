/**
 * Roles (§9). Two scopes:
 *
 * - Platform roles live on the user: every user is a customer; a few are
 *   platform admins.
 * - Restaurant roles are per restaurant, assigned via `restaurant_staff`
 *   (Day 12), so one person can be an owner in one place and a waiter in another.
 */
export const PLATFORM_ROLES = ["customer", "platform_admin"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const RESTAURANT_ROLES = ["owner", "manager", "waiter", "kitchen", "cashier"] as const;
export type RestaurantRole = (typeof RESTAURANT_ROLES)[number];

export const USER_STATUSES = ["active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
