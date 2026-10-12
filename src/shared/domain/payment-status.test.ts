import { describe, expect, it } from "vitest";

import { canMovePayment, isFinalPayment, isPaid, statusAfterRefund } from "./payment-status";

describe("payment status rules", () => {
  it("moves forward through the provider's answers", () => {
    expect(canMovePayment("pending", "processing")).toBe(true);
    expect(canMovePayment("processing", "succeeded")).toBe(true);
    expect(canMovePayment("pending", "failed")).toBe(true);
    expect(canMovePayment("succeeded", "refunded")).toBe(true);
    expect(canMovePayment("partially_refunded", "partially_refunded")).toBe(true);
  });

  it("never goes back: a late message can't undo a success or revive a failure", () => {
    expect(canMovePayment("succeeded", "failed")).toBe(false);
    expect(canMovePayment("succeeded", "pending")).toBe(false);
    expect(canMovePayment("failed", "succeeded")).toBe(false);
    expect(canMovePayment("cancelled", "succeeded")).toBe(false);
    expect(canMovePayment("refunded", "succeeded")).toBe(false);
    expect(canMovePayment("pending", "refunded")).toBe(false);
  });

  it("knows paid and final states, and the status after a refund", () => {
    expect(isPaid("succeeded")).toBe(true);
    expect(isPaid("partially_refunded")).toBe(true);
    expect(isPaid("processing")).toBe(false);
    expect(isFinalPayment("refunded")).toBe(true);
    expect(isFinalPayment("succeeded")).toBe(false);
    expect(statusAfterRefund(1000, 400)).toBe("partially_refunded");
    expect(statusAfterRefund(1000, 1000)).toBe("refunded");
  });
});
