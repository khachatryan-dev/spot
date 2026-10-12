import { describe, expect, it } from "vitest";

import { formatMoney, toMajorUnits, toMinorUnits } from "./money";

describe("money", () => {
  it.each([
    ["3500", 350000],
    ["3 500", 350000],
    ["3500.5", 350050],
    ["3500,25", 350025],
    ["0", 0],
  ])("toMinorUnits(%s, AMD) = %s", (input, expected) => {
    expect(toMinorUnits(input, "AMD")).toBe(expected);
  });

  it.each(["", "-5", "abc", "1.234", "1e5", "12.5.1"])("rejects %j", (input) => {
    expect(toMinorUnits(input, "AMD")).toBeNull();
  });

  it("round-trips through major units without float errors", () => {
    for (const minor of [0, 1, 10, 350000, 350050, 19999]) {
      expect(toMinorUnits(toMajorUnits(minor, "AMD"), "AMD")).toBe(minor);
    }
    expect(toMinorUnits("0.1", "USD")! + toMinorUnits("0.2", "USD")!).toBe(30);
  });

  it("formats prices the same way on every device", () => {
    expect(formatMoney(350000, "AMD", "hy")).toBe("3\u00a0500\u00a0֏");
    expect(formatMoney(350050, "AMD", "hy")).toBe("3\u00a0500,50\u00a0֏");
    expect(formatMoney(350000, "AMD", "en")).toBe("3,500\u00a0֏");
    expect(formatMoney(12345678900, "AMD", "en")).toBe("123,456,789\u00a0֏");
    expect(formatMoney(99, "AMD", "en")).toBe("0.99\u00a0֏");
    expect(formatMoney(0, "AMD", "hy")).toBe("0\u00a0֏");
    expect(formatMoney(-150000, "AMD", "en")).toBe("-1,500\u00a0֏");
    expect(formatMoney(1999, "USD", "en-US")).toBe("19.99\u00a0$");
  });
});
