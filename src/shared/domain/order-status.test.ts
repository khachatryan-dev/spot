import { describe, expect, it } from "vitest";

import { roleHasPermission } from "@/shared/auth/permissions";
import { ORDER_STATUSES } from "@/shared/constants/orders";

import { findTransition, isFinalStatus, nextStatuses } from "./order-status";

const can =
  (role: Parameters<typeof roleHasPermission>[0]) => (p: Parameters<typeof roleHasPermission>[1]) =>
    roleHasPermission(role, p);

describe("order status rules", () => {
  it("follows the kitchen flow", () => {
    expect(findTransition("submitted", "accepted")).not.toBeNull();
    expect(findTransition("accepted", "preparing")).not.toBeNull();
    expect(findTransition("preparing", "ready")).not.toBeNull();
    expect(findTransition("ready", "served")).not.toBeNull();
    expect(findTransition("served", "completed")).not.toBeNull();
  });

  it("refuses skipping, going back, or reviving finished orders", () => {
    expect(findTransition("submitted", "ready")).toBeNull();
    expect(findTransition("submitted", "served")).toBeNull();
    expect(findTransition("ready", "preparing")).toBeNull();
    expect(findTransition("served", "cancelled")).toBeNull();
    for (const final of ["completed", "cancelled", "rejected"] as const) {
      expect(isFinalStatus(final)).toBe(true);
      for (const to of ORDER_STATUSES) expect(findTransition(final, to)).toBeNull();
    }
  });

  it("requires a reason for rejecting and cancelling", () => {
    expect(findTransition("submitted", "rejected")?.reasonRequired).toBe(true);
    expect(findTransition("preparing", "cancelled")?.reasonRequired).toBe(true);
    expect(findTransition("submitted", "accepted")?.reasonRequired).toBeUndefined();
  });

  it("gives each role only its own steps", () => {
    expect(nextStatuses("submitted", can("kitchen"))).toEqual(["received", "accepted", "rejected"]);
    expect(nextStatuses("submitted", can("waiter"))).toEqual(["received"]);
    expect(nextStatuses("ready", can("kitchen"))).toEqual([]);
    expect(nextStatuses("ready", can("waiter"))).toEqual(["served"]);
    expect(nextStatuses("preparing", can("manager"))).toEqual(["ready", "cancelled"]);
    expect(nextStatuses("submitted", can("cashier"))).toEqual([]);
  });
});
