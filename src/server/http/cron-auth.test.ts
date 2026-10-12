import { describe, expect, it } from "vitest";

import { isCronAuthorized } from "./cron-auth";

describe("isCronAuthorized", () => {
  const secret = "a-long-random-cron-secret";

  it("accepts exactly the bearer secret", () => {
    expect(isCronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("rejects missing, wrong, partial or differently formatted values", () => {
    for (const header of [null, "", secret, `Bearer ${secret}x`, `bearer ${secret}`, "Bearer "]) {
      expect(isCronAuthorized(header, secret)).toBe(false);
    }
  });
});
