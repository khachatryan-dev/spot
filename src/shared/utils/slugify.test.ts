import { describe, expect, it } from "vitest";

import { slugify } from "./slugify";

describe("slugify", () => {
  it.each([
    ["Example Coffee", "example-coffee"],
    ["Կասկադ Սրճարան", "kaskad-srcharan"],
    ["Թումանյան 12", "tumanyan-12"],
    ["Ճաշարան «Ուրախ»", "chasharan-urakh"],
    ["Café Crème!!", "cafe-creme"],
    ["  --Hello__World--  ", "hello-world"],
    ["🍕🍕", ""],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("never ends with a hyphen after truncation", () => {
    expect(slugify("aaaa bbbb", 5)).toBe("aaaa");
  });
});
