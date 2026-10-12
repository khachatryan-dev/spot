import { describe, expect, it } from "vitest";

import { openingHoursSchema } from "./opening-hours";

const parse = (input: unknown) => openingHoursSchema.safeParse(input);

describe("openingHoursSchema", () => {
  it("accepts regular, split and overnight days, defaulting missing days to closed", () => {
    const result = parse({
      mon: [{ open: "09:00", close: "22:00" }],
      fri: [
        { open: "12:00", close: "15:00" },
        { open: "18:00", close: "02:00" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data?.sun).toEqual([]);
  });

  it.each([
    ["bad time", { mon: [{ open: "9:00", close: "22:00" }] }],
    ["24:00", { mon: [{ open: "10:00", close: "24:00" }] }],
    ["empty period", { mon: [{ open: "10:00", close: "10:00" }] }],
    [
      "overlap",
      {
        mon: [
          { open: "09:00", close: "15:00" },
          { open: "14:00", close: "20:00" },
        ],
      },
    ],
    [
      "overnight overlapping a later period",
      {
        mon: [
          { open: "18:00", close: "02:00" },
          { open: "20:00", close: "23:00" },
        ],
      },
    ],
    [
      "too many periods",
      { mon: Array.from({ length: 4 }, (_, i) => ({ open: `0${i}:00`, close: `0${i}:30` })) },
    ],
  ])("rejects %s", (_, input) => {
    expect(parse(input).success).toBe(false);
  });
});
