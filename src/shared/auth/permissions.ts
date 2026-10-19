import type { PlatformRole, RestaurantRole } from "@/shared/constants/roles";

/**
 * Permission model (§9). Checks always run on the server; the UI may use the
 * same map only to hide actions a user can't perform.
 */
export const RESTAURANT_PERMISSIONS = [
  "restaurant:read",
  "restaurant:update",
  "location:manage",
  "staff:read",
  "staff:manage",
  "menu:read",
  "menu:manage",
  /** Mark items out of stock without editing the menu (kitchen needs this). */
  "menu:availability",
  "table:read",
  "table:manage",
  "qr:manage",
  "order:read",
  "order:create",
  /** Kitchen statuses: accept, preparing, ready (§17). */
  "order:prepare",
  /** Service statuses: served, completed. */
  "order:serve",
  "order:cancel",
  "table_request:respond",
  /** End a table visit after service (frees the table). */
  "table_session:close",
  "reservation:read",
  /** Front-of-house steps: arrived, seated, completed. */
  "reservation:seat",
  /** Confirm, decline, cancel, no-show. */
  "reservation:manage",
  "bill:read",
  "bill:manage",
  "payment:confirm",
  "payment:refund",
  "review:respond",
  "analytics:read",
] as const;
export type RestaurantPermission = (typeof RESTAURANT_PERMISSIONS)[number];

export const PLATFORM_PERMISSIONS = [
  /** Entry to the admin area. */
  "platform:admin:access",
  "platform:restaurants:review",
  "platform:restaurants:manage",
  "platform:users:manage",
  "platform:reviews:moderate",
  /** Read and close contact-form messages. */
  "platform:messages:manage",
  "platform:payments:read",
  "platform:audit:read",
  "platform:analytics:read",
  "platform:settings:manage",
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

const MANAGER: readonly RestaurantPermission[] = [
  "restaurant:read",
  "staff:read",
  "menu:read",
  "menu:manage",
  "menu:availability",
  "table:read",
  "table:manage",
  "qr:manage",
  "order:read",
  "order:create",
  "order:prepare",
  "order:serve",
  "order:cancel",
  "table_request:respond",
  "table_session:close",
  "reservation:read",
  "reservation:seat",
  "reservation:manage",
  "bill:read",
  "bill:manage",
  "payment:confirm",
  "payment:refund",
  "review:respond",
  "analytics:read",
];

export const RESTAURANT_ROLE_PERMISSIONS: Record<
  RestaurantRole,
  ReadonlySet<RestaurantPermission>
> = {
  owner: new Set(RESTAURANT_PERMISSIONS),
  manager: new Set(MANAGER),
  waiter: new Set([
    "restaurant:read",
    "menu:read",
    "table:read",
    "order:read",
    "order:create",
    "order:serve",
    "table_request:respond",
    "table_session:close",
    "reservation:read",
    "reservation:seat",
    "bill:read",
  ]),
  // Kitchen sees what to cook — no customers, bills or payments (§17).
  // restaurant:read only exposes the name/status needed to open the dashboard.
  kitchen: new Set([
    "restaurant:read",
    "menu:read",
    "menu:availability",
    "order:read",
    "order:prepare",
  ]),
  cashier: new Set([
    "restaurant:read",
    "table:read",
    "table_session:close",
    "order:read",
    "bill:read",
    "bill:manage",
    "payment:confirm",
  ]),
};

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, ReadonlySet<PlatformPermission>> = {
  customer: new Set(),
  platform_admin: new Set(PLATFORM_PERMISSIONS),
};

export const roleHasPermission = (role: RestaurantRole, permission: RestaurantPermission) =>
  RESTAURANT_ROLE_PERMISSIONS[role].has(permission);

export const platformRoleHasPermission = (role: PlatformRole, permission: PlatformPermission) =>
  PLATFORM_ROLE_PERMISSIONS[role].has(permission);
