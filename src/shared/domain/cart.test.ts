import { describe, expect, it } from "vitest";

import {
  addLine,
  type CartLine,
  type MenuItemForCart,
  removeLine,
  resolveCart,
  setLineQuantity,
} from "./cart";

let n = 0;
const id = () => `line-${++n}`;

const pizza: MenuItemForCart = {
  id: "pizza",
  name: "Pizza",
  priceMinor: 350000,
  unavailable: null,
  modifierGroups: [
    {
      id: "size",
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: "small", name: "Small", priceDeltaMinor: 0, isAvailable: true, isDefault: true },
        { id: "large", name: "Large", priceDeltaMinor: 50000, isAvailable: true, isDefault: false },
      ],
    },
  ],
};
const menu = new Map([[pizza.id, pizza]]);

describe("cart lines", () => {
  it("merges identical choices and keeps different ones apart", () => {
    let lines: CartLine[] = [];
    lines = addLine(lines, { itemId: "pizza", modifierIds: ["large"], quantity: 1, note: "" }, id);
    lines = addLine(lines, { itemId: "pizza", modifierIds: ["large"], quantity: 2, note: "" }, id);
    lines = addLine(lines, { itemId: "pizza", modifierIds: ["small"], quantity: 1, note: "" }, id);
    lines = addLine(
      lines,
      { itemId: "pizza", modifierIds: ["large"], quantity: 1, note: "no onions" },
      id,
    );
    expect(lines.map((l) => [l.modifierIds[0], l.quantity, l.note])).toEqual([
      ["large", 3, ""],
      ["small", 1, ""],
      ["large", 1, "no onions"],
    ]);
  });

  it("caps quantities, and 0 removes a line", () => {
    let lines = addLine(
      [],
      { itemId: "pizza", modifierIds: ["small"], quantity: 49, note: "" },
      id,
    );
    lines = addLine(lines, { itemId: "pizza", modifierIds: ["small"], quantity: 5, note: "" }, id);
    expect(lines[0]?.quantity).toBe(50);
    expect(setLineQuantity(lines, lines[0]!.lineId, 0)).toEqual([]);
    expect(removeLine(lines, lines[0]!.lineId)).toEqual([]);
  });
});

describe("resolveCart", () => {
  const lines: CartLine[] = [
    { lineId: "a", itemId: "pizza", modifierIds: ["large"], quantity: 2, note: "" },
    { lineId: "b", itemId: "pizza", modifierIds: ["small"], quantity: 1, note: "" },
  ];

  it("prices lines from the current menu and totals them", () => {
    const cart = resolveCart(lines, menu);
    expect(
      cart.lines.map((l) => [l.name, l.modifierNames, l.unitPriceMinor, l.totalMinor]),
    ).toEqual([
      ["Pizza", ["Large"], 400000, 800000],
      ["Pizza", ["Small"], 350000, 350000],
    ]);
    expect(cart).toMatchObject({ subtotalMinor: 1150000, itemCount: 3, hasUnavailable: false });
  });

  it("uses today's price, not the price when added", () => {
    const pricier = new Map([[pizza.id, { ...pizza, priceMinor: 400000 }]]);
    expect(resolveCart([lines[1]!], pricier).subtotalMinor).toBe(400000);
  });

  it("flags lines whose item or option can't be ordered and leaves them out of the total", () => {
    const largeGone = new Map([
      [
        pizza.id,
        {
          ...pizza,
          modifierGroups: [
            {
              ...pizza.modifierGroups[0]!,
              modifiers: [{ ...pizza.modifierGroups[0]!.modifiers[0]! }],
            },
          ],
        },
      ],
    ]);
    const cart = resolveCart(lines, largeGone);
    expect(cart.lines.map((l) => l.available)).toEqual([false, true]);
    expect(cart).toMatchObject({ subtotalMinor: 350000, itemCount: 1, hasUnavailable: true });

    const outOfStock = new Map([[pizza.id, { ...pizza, unavailable: "outOfStock" }]]);
    expect(resolveCart(lines, outOfStock)).toMatchObject({
      subtotalMinor: 0,
      hasUnavailable: true,
    });
    expect(resolveCart(lines, new Map())).toMatchObject({ subtotalMinor: 0, hasUnavailable: true });
  });
});
