import { describe, expect, it } from "vitest";

import { updateLocationSchema } from "./location";

describe("updateLocationSchema", () => {
  it("parses form strings into coordinates and empty strings into null", () => {
    expect(updateLocationSchema.parse({ latitude: "40.1792", longitude: "44,4991" })).toEqual({
      latitude: 40.1792,
      longitude: 44.4991,
    });
    expect(updateLocationSchema.parse({ latitude: "", longitude: "" })).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it.each([
    ["only one coordinate", { latitude: "40.1", longitude: "" }],
    ["latitude out of range", { latitude: "95", longitude: "44" }],
    ["non-numeric coordinate", { latitude: "abc", longitude: "44" }],
    ["unknown time zone", { timezone: "Mars/Olympus" }],
    ["bad opening hours", { openingHours: { mon: [{ open: "25:00", close: "10:00" }] } }],
    ["unknown status", { status: "deleted" }],
  ])("rejects %s", (_, input) => {
    expect(updateLocationSchema.safeParse(input).success).toBe(false);
  });

  it("accepts a real IANA time zone", () => {
    expect(updateLocationSchema.parse({ timezone: "Asia/Yerevan" })).toEqual({
      timezone: "Asia/Yerevan",
    });
  });
});
