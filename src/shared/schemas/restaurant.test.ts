import { describe, expect, it } from "vitest";

import { createRestaurantSchema, updateRestaurantSchema } from "./restaurant";

describe("restaurant schemas", () => {
  it("normalizes empty optional fields to null and lowercases email", () => {
    const parsed = createRestaurantSchema.parse({
      name: "  Cafe  ",
      description: "",
      phone: "",
      email: "Hi@Cafe.AM",
      website: "",
    });
    expect(parsed).toMatchObject({
      name: "Cafe",
      description: null,
      phone: null,
      email: "hi@cafe.am",
      website: null,
      cuisines: [],
    });
  });

  it.each([
    ["unknown cuisine", { cuisines: ["martian"] }],
    ["too many cuisines", { cuisines: ["armenian", "italian", "pizza", "bar", "wine", "cafe"] }],
    ["duplicate cuisine", { cuisines: ["pizza", "pizza"] }],
    ["price range 0", { priceRange: 0 }],
    ["non-http website", { website: "javascript:alert(1)" }],
    ["invalid email", { email: "not-an-email" }],
  ])("rejects %s", (_, patch) => {
    expect(createRestaurantSchema.safeParse({ name: "Cafe", ...patch }).success).toBe(false);
  });

  it("leaves omitted fields out of partial updates and strips unknown fields", () => {
    const parsed = updateRestaurantSchema.parse({ priceRange: 2, status: "active" });
    expect(parsed).toEqual({ priceRange: 2 });
  });
});
