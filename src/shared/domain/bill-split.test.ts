import { describe, expect, it } from "vitest";

import { equalShare, itemsAmount } from "./bill-split";

describe("equalShare", () => {
  it("splits evenly and gives the rounding difference to the last share", () => {
    // 10 000 ֏ three ways: 3 333 + 3 333 + 3 334.
    const shares = [1, 2, 3].map((i) => equalShare(1_000_000, 3, i, "AMD"));
    expect(shares).toEqual([333_300, 333_300, 333_400]);
    expect(shares.reduce((a, b) => a + b)).toBe(1_000_000);
  });

  it("never leaves the last share short or negative, even for tiny totals", () => {
    // 10 ֏ twenty ways: nineteen shares of 0 and one of 10 ֏ — still exact.
    const shares = Array.from({ length: 20 }, (_, i) => equalShare(1_000, 20, i + 1, "AMD"));
    expect(shares.every((share) => share >= 0)).toBe(true);
    expect(shares.reduce((a, b) => a + b)).toBe(1_000);
    expect(equalShare(1_100_000, 3, 3, "AMD")).toBeGreaterThanOrEqual(
      equalShare(1_100_000, 3, 1, "AMD"),
    );
  });

  it("adds up for any number of ways", () => {
    for (let count = 2; count <= 20; count++) {
      const sum = Array.from({ length: count }, (_, i) =>
        equalShare(1_234_500, count, i + 1, "AMD"),
      ).reduce((a, b) => a + b);
      expect(sum).toBe(1_234_500);
    }
  });
});

describe("itemsAmount", () => {
  // Lines 8 000 + 2 000 = 10 000 ֏; 10 % service → total 11 000 ֏.
  const bill = { subtotalMinor: 1_000_000, totalMinor: 1_100_000, currency: "AMD" };

  it("charges the lines' share of the service charge", () => {
    expect(itemsAmount({ ...bill, linesMinor: 200_000, heldMinor: 0, isLast: false })).toBe(
      220_000,
    );
  });

  it("makes the last payment take exactly what's left", () => {
    expect(itemsAmount({ ...bill, linesMinor: 800_000, heldMinor: 220_000, isLast: true })).toBe(
      880_000,
    );
  });

  it("rounds to whole dram without ever exceeding what's left", () => {
    const odd = { subtotalMinor: 300_000, totalMinor: 330_000, currency: "AMD" };
    const first = itemsAmount({ ...odd, linesMinor: 100_000, heldMinor: 0, isLast: false });
    expect(first % 100).toBe(0);
    expect(first).toBe(110_000);
  });
});
