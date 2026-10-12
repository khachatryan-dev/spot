import { describe, expect, it } from "vitest";

import { assertPublicHttpsUrl, isPublicAddress } from "./outbound";

describe("isPublicAddress", () => {
  it("refuses private, loopback, link-local and mapped addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "not-an-ip",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("allows public addresses", () => {
    for (const address of ["8.8.8.8", "185.12.1.1", "2a00:1450:4001::200e", "::ffff:8.8.8.8"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });
});

describe("assertPublicHttpsUrl", () => {
  it("accepts https host names", () => {
    expect(assertPublicHttpsUrl("https://1c.example.am/base/hs/spot").hostname).toBe(
      "1c.example.am",
    );
  });

  it.each([
    "http://1c.example.am",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://localhost/x",
    "https://box.local/x",
    "https://user:pass@1c.example.am",
    "ftp://1c.example.am",
    "nonsense",
  ])("refuses %s", (url) => {
    expect(() => assertPublicHttpsUrl(url)).toThrow();
  });
});
