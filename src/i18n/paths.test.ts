import { describe, expect, it } from "vitest";

import { isProtectedPath, localizePath, splitLocale } from "./paths";

describe("splitLocale", () => {
  it.each([
    ["/en/dashboard", { locale: "en", path: "/dashboard" }],
    ["/en", { locale: "en", path: "/" }],
    ["/hy/admin/users", { locale: "hy", path: "/admin/users" }],
    ["/dashboard", { locale: "hy", path: "/dashboard" }],
    ["/", { locale: "hy", path: "/" }],
    ["/english-menu", { locale: "hy", path: "/english-menu" }],
  ])("%s", (input, expected) => {
    expect(splitLocale(input)).toEqual(expected);
  });
});

describe("localizePath", () => {
  it("leaves the default locale unprefixed and prefixes others", () => {
    expect(localizePath("/login", "hy")).toBe("/login");
    expect(localizePath("/login", "en")).toBe("/en/login");
    expect(localizePath("/", "en")).toBe("/en");
  });
});

describe("isProtectedPath", () => {
  it.each([
    ["/dashboard", true],
    ["/dashboard/orders", true],
    ["/admin", true],
    ["/admin/users", true],
    ["/", false],
    ["/login", false],
    ["/dashboards", false],
    ["/administrator-bio", false],
  ])("%s → %s", (path, expected) => {
    expect(isProtectedPath(path)).toBe(expected);
  });
});
