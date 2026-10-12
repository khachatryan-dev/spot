import { describe, expect, it } from "vitest";

import { AppError } from "@/shared/errors";

import { assertSameOrigin } from "./same-origin";

const request = (origin: string | null) =>
  new Request("http://localhost:3000/api/restaurants/x/images/logo", {
    method: "POST",
    headers: origin ? { origin } : {},
  });

describe("assertSameOrigin", () => {
  it("allows requests from the app's own origin", () => {
    expect(() => assertSameOrigin(request("http://localhost:3000"))).not.toThrow();
  });

  it.each(["https://evil.example", "http://localhost:3000.evil.example", "null", null])(
    "blocks origin %s",
    (origin) => {
      expect(() => assertSameOrigin(request(origin))).toThrow(AppError);
    },
  );
});
