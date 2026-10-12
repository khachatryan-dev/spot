import { describe, expect, it } from "vitest";

import { billAmounts, roundToCoin } from "./bill-math";

describe("roundToCoin", () => {
  it("rounds AMD half-up to whole dram, other currencies to the minor unit", () => {
    expect(roundToCoin(35_550, "AMD")).toBe(35_600);
    expect(roundToCoin(35_549, "AMD")).toBe(35_500);
    expect(roundToCoin(1_234.5, "USD")).toBe(1_235);
  });
});

describe("billAmounts", () => {
  it("adds a service charge after discounts", () => {
    expect(
      billAmounts({
        lineTotals: [450_000, 355_500],
        discountMinor: 5_500,
        serviceFeeBps: 1000,
        vatRateBps: 0,
        currency: "AMD",
      }),
    ).toEqual({
      subtotalMinor: 805_500,
      discountMinor: 5_500,
      serviceFeeBps: 1000,
      serviceFeeMinor: 80_000,
      vatRateBps: 0,
      taxIncludedMinor: 0,
      totalMinor: 880_000,
    });
  });

  it("extracts the VAT already included in the total", () => {
    // 12 000 ֏ incl. 20 % VAT → 2 000 ֏ is VAT.
    const amounts = billAmounts({
      lineTotals: [1_200_000],
      serviceFeeBps: 0,
      vatRateBps: 2000,
      currency: "AMD",
    });
    expect(amounts.totalMinor).toBe(1_200_000);
    expect(amounts.taxIncludedMinor).toBe(200_000);
  });

  it("rounds the service charge to whole dram and keeps the total exact", () => {
    const amounts = billAmounts({
      lineTotals: [355_500],
      serviceFeeBps: 1000,
      vatRateBps: 0,
      currency: "AMD",
    });
    expect(amounts.serviceFeeMinor).toBe(35_600);
    expect(amounts.totalMinor).toBe(391_100);
  });

  it("never discounts below zero and handles an empty bill", () => {
    expect(
      billAmounts({
        lineTotals: [1000],
        discountMinor: 5000,
        serviceFeeBps: 0,
        vatRateBps: 0,
        currency: "AMD",
      }).totalMinor,
    ).toBe(0);
    expect(
      billAmounts({ lineTotals: [], serviceFeeBps: 1000, vatRateBps: 2000, currency: "AMD" }),
    ).toMatchObject({ subtotalMinor: 0, serviceFeeMinor: 0, taxIncludedMinor: 0, totalMinor: 0 });
  });
});
