import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/en/dashboard?tab=orders#top", "/en/dashboard?tab=orders#top"],
  ])("keeps same-site path %s", (input, expected) => {
    expect(safeRedirectPath(input, "/")).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "dashboard",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "javascript:alert(1)",
    "/api/auth/sign-out",
  ])("rejects %s", (input) => {
    expect(safeRedirectPath(input, "/fallback")).toBe("/fallback");
  });
});
