import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { truncate } from "@/test/db";

import { clientIp, hitRateLimit } from "./rate-limit";

beforeEach(() => truncate(db, ["rate_limits"]));

describe("hitRateLimit", () => {
  const limit = { max: 3, windowMs: 60_000 };

  it("allows up to the limit within a window, then blocks", async () => {
    const now = 1_000_000;
    const results = [];
    for (let i = 0; i < 5; i++)
      results.push((await hitRateLimit("test:a", limit, now + i)).allowed);
    expect(results).toEqual([true, true, true, false, false]);
  });

  it("starts counting again in the next window", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 4; i++) await hitRateLimit("test:a", limit, now);
    expect((await hitRateLimit("test:a", limit, now + 60_001)).allowed).toBe(true);
  });

  it("counts keys separately", async () => {
    for (let i = 0; i < 3; i++) await hitRateLimit("test:a", limit);
    expect((await hitRateLimit("test:b", limit)).allowed).toBe(true);
  });

  it("counts correctly under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => hitRateLimit("test:c", limit)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for entry, then x-real-ip", () => {
    const req = (headers: Record<string, string>) => new Request("http://x", { headers });
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(req({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(req({}))).toBe("unknown");
  });
});
