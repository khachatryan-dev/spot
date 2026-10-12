import { describe, expect, it } from "vitest";

import { roleHasPermission } from "@/shared/auth/permissions";
import type { RestaurantRole } from "@/shared/constants/roles";

import { actionBlocker, availableActions, canCustomerCancel } from "./reservation-status";

const START = new Date("2030-01-18T15:00:00Z");
const BEFORE = new Date("2030-01-18T14:00:00Z");
const AFTER = new Date("2030-01-18T15:20:00Z");
const as = (role: RestaurantRole) => (p: Parameters<typeof roleHasPermission>[1]) =>
  roleHasPermission(role, p);
const r = (status: Parameters<typeof actionBlocker>[1]["status"]) => ({ status, startsAt: START });

describe("availableActions", () => {
  it("lets managers answer a request: confirm or decline", () => {
    expect(availableActions(r("pending_confirmation"), as("manager"), BEFORE)).toEqual([
      "confirm",
      "decline",
    ]);
  });

  it("walks a confirmed booking through arrival, seating and completion", () => {
    expect(availableActions(r("confirmed"), as("owner"), BEFORE)).toEqual([
      "arrive",
      "seat",
      "cancel",
    ]);
    expect(availableActions(r("arrived"), as("owner"), BEFORE)).toEqual(["seat", "cancel"]);
    expect(availableActions(r("seated"), as("owner"), BEFORE)).toEqual(["complete"]);
  });

  it("allows no-show only after the start time", () => {
    expect(availableActions(r("confirmed"), as("manager"), AFTER)).toContain("no_show");
    expect(actionBlocker("no_show", r("confirmed"), BEFORE)).toBe("tooEarly");
  });

  it("gives waiters the front-of-house steps only", () => {
    expect(availableActions(r("pending_confirmation"), as("waiter"), BEFORE)).toEqual([]);
    expect(availableActions(r("confirmed"), as("waiter"), AFTER)).toEqual(["arrive", "seat"]);
    expect(availableActions(r("confirmed"), as("kitchen"), AFTER)).toEqual([]);
    expect(availableActions(r("confirmed"), as("cashier"), AFTER)).toEqual([]);
  });

  it("allows nothing once a reservation has ended", () => {
    for (const status of ["completed", "cancelled", "no_show", "expired"] as const) {
      expect(availableActions(r(status), as("owner"), AFTER)).toEqual([]);
    }
    expect(actionBlocker("seat", r("cancelled"), BEFORE)).toBe("status");
  });
});

describe("canCustomerCancel", () => {
  it("lets guests cancel pending or confirmed bookings until they start", () => {
    expect(canCustomerCancel(r("pending_confirmation"), BEFORE)).toBe(true);
    expect(canCustomerCancel(r("confirmed"), BEFORE)).toBe(true);
    expect(canCustomerCancel(r("confirmed"), START)).toBe(false);
    expect(canCustomerCancel(r("seated"), BEFORE)).toBe(false);
    expect(canCustomerCancel(r("cancelled"), BEFORE)).toBe(false);
  });
});
