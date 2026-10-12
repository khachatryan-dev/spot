import { describe, expect, it } from "vitest";

import { RESTAURANT_STATUSES } from "@/shared/constants/restaurants";

import { canTransition, isPubliclyVisible } from "./restaurant-status";

describe("restaurant status transitions", () => {
  it("lets owners submit drafts but not approve them", () => {
    expect(canTransition("draft", "pending_review", "owner")).toBe(true);
    expect(canTransition("pending_review", "active", "owner")).toBe(false);
    expect(canTransition("draft", "active", "owner")).toBe(false);
  });

  it("lets only platform admins approve, suspend and reinstate", () => {
    expect(canTransition("pending_review", "active", "platform_admin")).toBe(true);
    expect(canTransition("active", "suspended", "platform_admin")).toBe(true);
    expect(canTransition("suspended", "active", "platform_admin")).toBe(true);
    expect(canTransition("active", "suspended", "owner")).toBe(false);
    expect(canTransition("suspended", "active", "owner")).toBe(false);
  });

  it("keeps closed final", () => {
    for (const to of RESTAURANT_STATUSES) {
      expect(canTransition("closed", to, "owner")).toBe(false);
      expect(canTransition("closed", to, "platform_admin")).toBe(false);
    }
  });

  it("shows only active restaurants publicly", () => {
    expect(RESTAURANT_STATUSES.filter(isPubliclyVisible)).toEqual(["active"]);
  });
});
