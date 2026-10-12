import { describe, expect, it } from "vitest";

import { qrSvgDataUri } from "./qr-image";

describe("qrSvgDataUri", () => {
  it("returns an SVG data URI", async () => {
    const uri = await qrSvgDataUri("https://spot.am/t/AbCdEfGhIjKlMnOpQrStUv");
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svg = Buffer.from(uri.split(",")[1]!, "base64").toString();
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<script");
  });

  it("encodes different URLs differently", async () => {
    expect(await qrSvgDataUri("https://spot.am/t/a")).not.toBe(
      await qrSvgDataUri("https://spot.am/t/b"),
    );
  });
});
