import { describe, expect, it } from "vitest";

import {
  defaultSelection,
  type SelectableGroup,
  selectionProblems,
  toggleModifier,
  unitPriceMinor,
} from "./item-selection";

const mod = (
  id: string,
  price = 0,
  extra: Partial<{ isAvailable: boolean; isDefault: boolean }> = {},
) => ({
  id,
  priceDeltaMinor: price,
  isAvailable: true,
  isDefault: false,
  ...extra,
});

const size: SelectableGroup = {
  id: "size",
  minSelect: 1,
  maxSelect: 1,
  modifiers: [
    mod("small", 0, { isDefault: true }),
    mod("large", 50000),
    mod("huge", 90000, { isAvailable: false }),
  ],
};
const extras: SelectableGroup = {
  id: "extras",
  minSelect: 0,
  maxSelect: 2,
  modifiers: [mod("cheese", 30000), mod("ham", 40000), mod("olives", 20000)],
};
const groups = [size, extras];

describe("defaultSelection", () => {
  it("picks available defaults within each group's maximum", () => {
    expect(defaultSelection(groups)).toEqual(["small"]);
    const twoDefaults: SelectableGroup = {
      ...size,
      modifiers: [mod("a", 0, { isDefault: true }), mod("b", 0, { isDefault: true })],
    };
    expect(defaultSelection([twoDefaults])).toEqual(["a"]);
    const unavailableDefault: SelectableGroup = {
      ...size,
      modifiers: [mod("a", 0, { isDefault: true, isAvailable: false })],
    };
    expect(defaultSelection([unavailableDefault])).toEqual([]);
  });
});

describe("selectionProblems", () => {
  it("accepts a valid selection", () => {
    expect(selectionProblems(groups, ["large", "cheese", "ham"])).toEqual([]);
  });

  it("requires required groups and caps maximums", () => {
    expect(selectionProblems(groups, [])).toEqual([{ groupId: "size", problem: "tooFew", min: 1 }]);
    expect(selectionProblems(groups, ["small", "cheese", "ham", "olives"])).toEqual([
      { groupId: "extras", problem: "tooMany", max: 2 },
    ]);
    expect(selectionProblems(groups, ["small", "large"])).toContainEqual({
      groupId: "size",
      problem: "tooMany",
      max: 1,
    });
  });

  it("refuses unavailable, unknown and duplicated options", () => {
    expect(selectionProblems(groups, ["huge"])).toContainEqual({
      groupId: "size",
      problem: "unavailable",
      modifierId: "huge",
    });
    expect(selectionProblems(groups, ["small", "other-restaurants-modifier"])).toContainEqual({
      groupId: null,
      problem: "unknownModifier",
      modifierId: "other-restaurants-modifier",
    });
    expect(selectionProblems(groups, ["small", "cheese", "cheese"])).toContainEqual({
      groupId: null,
      problem: "duplicate",
      modifierId: "cheese",
    });
  });
});

describe("unitPriceMinor", () => {
  it("adds chosen options to the item price", () => {
    expect(unitPriceMinor(350000, groups, ["large", "cheese"])).toBe(430000);
    expect(unitPriceMinor(350000, groups, [])).toBe(350000);
  });
});

describe("toggleModifier", () => {
  it("replaces the choice in a pick-one group and won't clear a required one", () => {
    expect(toggleModifier(groups, ["small"], "large")).toEqual(["large"]);
    expect(toggleModifier(groups, ["large"], "large")).toEqual(["large"]);
  });

  it("adds and removes in multi-choice groups, up to the maximum", () => {
    let selection = toggleModifier(groups, ["small"], "cheese");
    selection = toggleModifier(groups, selection, "ham");
    expect(toggleModifier(groups, selection, "olives")).toEqual(["small", "cheese", "ham"]);
    expect(toggleModifier(groups, selection, "cheese")).toEqual(["small", "ham"]);
  });

  it("ignores unavailable or unknown options", () => {
    expect(toggleModifier(groups, ["small"], "huge")).toEqual(["small"]);
    expect(toggleModifier(groups, ["small"], "nope")).toEqual(["small"]);
  });
});
