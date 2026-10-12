import { test as base } from "@playwright/test";
import postgres from "postgres";

export { type Browser, expect, type Page } from "@playwright/test";

/** Direct access to the E2E database for test setup (e.g. promoting an admin). */
export const sql = postgres("postgresql://spot:spot@localhost:5432/spot_test", {
  max: 1,
  onnotice: () => {},
});

/**
 * Every test starts with fresh auth rate-limit counters, so the real limits
 * (e.g. 5 sign-ups per hour per IP) stay on without breaking a full E2E run.
 */
export const test = base.extend<{ resetRateLimits: void }>({
  resetRateLimits: [
    async ({}, use) => {
      await sql`DELETE FROM rate_limits`;
      await use();
    },
    { auto: true },
  ],
});
