import { describe, expect, it } from "vitest";

import { depositFor, isRefundableCancellation } from "./reservation-deposit";

describe("depositFor", () => {
  it("charges per guest, per booking, or nothing", () => {
    expect(depositFor({ depositType: "per_guest", depositMinor: 200_000 }, 3)).toBe(600_000);
    expect(depositFor({ depositType: "per_booking", depositMinor: 500_000 }, 3)).toBe(500_000);
    expect(depositFor({ depositType: "none", depositMinor: 500_000 }, 3)).toBe(0);
  });
});

describe("isRefundableCancellation", () => {
  const start = new Date("2030-01-18T15:00:00Z");
  it("refunds up to the cutoff, not after", () => {
    expect(isRefundableCancellation(start, 24, new Date("2030-01-17T15:00:00Z"))).toBe(true);
    expect(isRefundableCancellation(start, 24, new Date("2030-01-17T15:00:01Z"))).toBe(false);
    expect(isRefundableCancellation(start, 0, new Date("2030-01-18T14:59:00Z"))).toBe(true);
  });
});
