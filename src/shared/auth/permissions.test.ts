import { describe, expect, it } from "vitest";

import { RESTAURANT_ROLES } from "@/shared/constants/roles";

import {
  PLATFORM_PERMISSIONS,
  platformRoleHasPermission,
  RESTAURANT_PERMISSIONS,
  roleHasPermission,
  type RestaurantPermission,
} from "./permissions";

describe("restaurant role permissions", () => {
  it("gives the owner every permission", () => {
    for (const permission of RESTAURANT_PERMISSIONS) {
      expect(roleHasPermission("owner", permission)).toBe(true);
    }
  });

  it("keeps staff management and restaurant settings with the owner only", () => {
    for (const role of RESTAURANT_ROLES.filter((r) => r !== "owner")) {
      expect(roleHasPermission(role, "staff:manage")).toBe(false);
      expect(roleHasPermission(role, "restaurant:update")).toBe(false);
      expect(roleHasPermission(role, "location:manage")).toBe(false);
    }
  });

  it("limits the kitchen to preparation (no bills, payments, customers' reservations)", () => {
    const allowed: RestaurantPermission[] = [
      "restaurant:read",
      "menu:read",
      "menu:availability",
      "order:read",
      "order:prepare",
    ];
    for (const permission of RESTAURANT_PERMISSIONS) {
      expect(roleHasPermission("kitchen", permission)).toBe(allowed.includes(permission));
    }
  });

  it("lets waiters serve but not cook, refund or edit the menu", () => {
    expect(roleHasPermission("waiter", "order:serve")).toBe(true);
    expect(roleHasPermission("waiter", "table_request:respond")).toBe(true);
    expect(roleHasPermission("waiter", "order:prepare")).toBe(false);
    expect(roleHasPermission("waiter", "payment:refund")).toBe(false);
    expect(roleHasPermission("waiter", "menu:manage")).toBe(false);
  });

  it("lets cashiers confirm payments but not refund or touch the menu", () => {
    expect(roleHasPermission("cashier", "payment:confirm")).toBe(true);
    expect(roleHasPermission("cashier", "bill:manage")).toBe(true);
    expect(roleHasPermission("cashier", "payment:refund")).toBe(false);
    expect(roleHasPermission("cashier", "menu:manage")).toBe(false);
  });

  it("lets service staff close table visits, but not the kitchen", () => {
    const closers = RESTAURANT_ROLES.filter((r) => roleHasPermission(r, "table_session:close"));
    expect(closers).toEqual(["owner", "manager", "waiter", "cashier"]);
  });

  it("lets only owners and managers refund", () => {
    const refunders = RESTAURANT_ROLES.filter((r) => roleHasPermission(r, "payment:refund"));
    expect(refunders).toEqual(["owner", "manager"]);
  });
});

describe("platform role permissions", () => {
  it("gives platform admins every platform permission and customers none", () => {
    for (const permission of PLATFORM_PERMISSIONS) {
      expect(platformRoleHasPermission("platform_admin", permission)).toBe(true);
      expect(platformRoleHasPermission("customer", permission)).toBe(false);
    }
  });
});
