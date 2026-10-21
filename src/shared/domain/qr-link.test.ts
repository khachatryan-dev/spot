import { describe, expect, it } from "vitest";

import { tablePathFromScan } from "./qr-link";

const ours = ["https://spot.am", "http://localhost:3000"];
const token = "AbCdEfGhIjKlMnOpQrStUv";

describe("tablePathFromScan", () => {
  it("opens our table links, with or without a language prefix", () => {
    expect(tablePathFromScan(`https://spot.am/t/${token}`, ours)).toBe(`/t/${token}`);
    expect(tablePathFromScan(` https://spot.am/en/t/${token} `, ours)).toBe(`/t/${token}`);
    expect(tablePathFromScan(`http://localhost:3000/t/${token}?x=1`, ours)).toBe(`/t/${token}`);
  });

  it("refuses other sites, other pages and malformed tokens", () => {
    expect(tablePathFromScan(`https://evil.example/t/${token}`, ours)).toBeNull();
    expect(tablePathFromScan(`https://spot.am.evil.example/t/${token}`, ours)).toBeNull();
    expect(tablePathFromScan("https://spot.am/admin", ours)).toBeNull();
    expect(tablePathFromScan(`https://spot.am/admin/t/${token}`, ours)).toBeNull();
    expect(tablePathFromScan("https://spot.am/t/short", ours)).toBeNull();
    expect(tablePathFromScan(`https://spot.am/t/${token}/extra`, ours)).toBeNull();
    expect(tablePathFromScan("not a link", ours)).toBeNull();
    expect(tablePathFromScan(`javascript:alert(1)//spot.am/t/${token}`, ours)).toBeNull();
  });
});
