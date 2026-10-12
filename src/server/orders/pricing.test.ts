import { describe, expect, it } from "vitest";

import { AppError } from "@/shared/errors";
import { orderRequestSchema } from "@/shared/schemas/order";

import { type Catalog, type CatalogItem, MAX_ORDER_TOTAL_MINOR, priceOrder } from "./pricing";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PIZZA = uuid(1);
const SOUP = uuid(2);
const SMALL = uuid(11);
const LARGE = uuid(12);
const CHEESE = uuid(13);
const GONE = uuid(14);

const pizza: CatalogItem = {
  id: PIZZA,
  name: "Margherita",
  priceMinor: 350000,
  unavailable: null,
  modifierGroups: [
    {
      id: uuid(21),
      name: "Size",
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: SMALL, name: "Small", priceDeltaMinor: 0, isAvailable: true, isDefault: true },
        { id: LARGE, name: "Large", priceDeltaMinor: 50000, isAvailable: true, isDefault: false },
      ],
    },
    {
      id: uuid(22),
      name: "Extras",
      minSelect: 0,
      maxSelect: 2,
      modifiers: [
        { id: CHEESE, name: "Cheese", priceDeltaMinor: 30000, isAvailable: true, isDefault: false },
        { id: GONE, name: "Ham", priceDeltaMinor: 40000, isAvailable: false, isDefault: false },
      ],
    },
  ],
};
const soup: CatalogItem = {
  id: SOUP,
  name: "Khash",
  priceMinor: 400000,
  unavailable: null,
  modifierGroups: [],
};
const catalog: Catalog = new Map([
  [PIZZA, pizza],
  [SOUP, soup],
]);

const request = (lines: unknown[], extra: Record<string, unknown> = {}) =>
  orderRequestSchema.parse({ lines, idempotencyKey: "checkout-0001", ...extra });

function problems(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return { code: (error as AppError).code, fields: (error as AppError).fieldErrors };
  }
  throw new Error("expected priceOrder to throw");
}

describe("priceOrder", () => {
  it("prices lines and totals from the catalog", () => {
    const priced = priceOrder(
      request([
        { itemId: PIZZA, modifierIds: [LARGE, CHEESE], quantity: 2, note: " no basil " },
        { itemId: SOUP, quantity: 1 },
      ]),
      catalog,
    );
    expect(priced.lines).toEqual([
      {
        menuItemId: PIZZA,
        name: "Margherita",
        unitPriceMinor: 350000,
        modifiersTotalMinor: 80000,
        quantity: 2,
        lineTotalMinor: 860000,
        note: "no basil",
        modifiers: [
          { modifierId: LARGE, groupName: "Size", name: "Large", priceDeltaMinor: 50000 },
          { modifierId: CHEESE, groupName: "Extras", name: "Cheese", priceDeltaMinor: 30000 },
        ],
      },
      {
        menuItemId: SOUP,
        name: "Khash",
        unitPriceMinor: 400000,
        modifiersTotalMinor: 0,
        quantity: 1,
        lineTotalMinor: 400000,
        note: null,
        modifiers: [],
      },
    ]);
    expect(priced).toMatchObject({ subtotalMinor: 1260000, discountMinor: 0, totalMinor: 1260000 });
  });

  it("ignores prices and names sent by the client", () => {
    const tampered = request(
      [
        {
          itemId: SOUP,
          quantity: 1,
          priceMinor: 1,
          unitPriceMinor: 1,
          name: "Free soup",
          lineTotalMinor: 0,
        },
      ],
      { totalMinor: 1, subtotalMinor: 1, discountMinor: 999999 },
    );
    const priced = priceOrder(tampered, catalog);
    expect(priced.lines[0]).toMatchObject({
      name: "Khash",
      unitPriceMinor: 400000,
      lineTotalMinor: 400000,
    });
    expect(priced).toMatchObject({ totalMinor: 400000, discountMinor: 0 });
  });

  it("rejects items not in the catalog (other location, other restaurant, not served now)", () => {
    expect(
      problems(() => priceOrder(request([{ itemId: uuid(99), quantity: 1 }]), catalog)),
    ).toEqual({
      code: "ORDER_UNAVAILABLE",
      fields: { "lines.0": ["itemUnavailable"] },
    });
  });

  it("points at exactly the lines that can't be ordered", () => {
    const outOfStock = new Map(catalog).set(SOUP, { ...soup, unavailable: "outOfStock" });
    const result = problems(() =>
      priceOrder(
        request([
          { itemId: PIZZA, modifierIds: [SMALL], quantity: 1 },
          { itemId: SOUP, quantity: 1 },
          { itemId: PIZZA, modifierIds: [], quantity: 1 }, // required size missing
        ]),
        outOfStock,
      ),
    );
    expect(result.fields).toEqual({ "lines.1": ["outOfStock"], "lines.2": ["optionsInvalid"] });
  });

  it("rejects invalid option choices", () => {
    const cases = [
      [SMALL, LARGE], // two sizes in a pick-one group
      [SMALL, GONE], // unavailable option
      [SMALL, uuid(77)], // option of another item / unknown
      [SMALL, CHEESE, CHEESE], // duplicated option
    ];
    for (const modifierIds of cases) {
      expect(
        problems(() => priceOrder(request([{ itemId: PIZZA, modifierIds, quantity: 1 }]), catalog))
          .fields,
      ).toEqual({
        "lines.0": ["optionsInvalid"],
      });
    }
    // An option chosen for an item without options at all.
    expect(
      problems(() =>
        priceOrder(request([{ itemId: SOUP, modifierIds: [CHEESE], quantity: 1 }]), catalog),
      ).fields,
    ).toEqual({
      "lines.0": ["optionsInvalid"],
    });
  });

  it("refuses orders whose total would overflow", () => {
    const huge = new Map(catalog).set(SOUP, { ...soup, priceMinor: MAX_ORDER_TOTAL_MINOR });
    expect(
      problems(() => priceOrder(request([{ itemId: SOUP, quantity: 2 }]), huge)).fields,
    ).toEqual({ lines: ["orderTooLarge"] });
  });
});

describe("orderRequestSchema", () => {
  it.each([
    ["empty order", { lines: [] }],
    ["quantity 0", { lines: [{ itemId: SOUP, quantity: 0 }] }],
    ["quantity 51", { lines: [{ itemId: SOUP, quantity: 51 }] }],
    ["fractional quantity", { lines: [{ itemId: SOUP, quantity: 1.5 }] }],
    ["non-uuid item", { lines: [{ itemId: "1", quantity: 1 }] }],
    [
      "too many lines",
      { lines: Array.from({ length: 51 }, () => ({ itemId: SOUP, quantity: 1 })) },
    ],
    ["long note", { lines: [{ itemId: SOUP, quantity: 1, note: "x".repeat(201) }] }],
  ])("rejects %s", (_, body) => {
    expect(orderRequestSchema.safeParse({ idempotencyKey: "checkout-0001", ...body }).success).toBe(
      false,
    );
  });

  it("requires an idempotency key", () => {
    expect(orderRequestSchema.safeParse({ lines: [{ itemId: SOUP, quantity: 1 }] }).success).toBe(
      false,
    );
  });
});
