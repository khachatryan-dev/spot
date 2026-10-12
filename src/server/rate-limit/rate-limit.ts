import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/server/db/client";

/**
 * Fixed-window rate limit stored in Postgres (shared by all server instances).
 * Reuses the `rate_limits` table; keys are namespaced ("scan:1.2.3.4") so they
 * never collide with Better Auth's own entries.
 */
export async function hitRateLimit(
  key: string,
  { max, windowMs }: { max: number; windowMs: number },
  now = Date.now(),
): Promise<{ allowed: boolean; count: number }> {
  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, count, last_request)
    VALUES (${key}, 1, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.last_request <= ${now - windowMs} THEN 1 ELSE rate_limits.count + 1 END,
      last_request = CASE WHEN rate_limits.last_request <= ${now - windowMs} THEN ${now} ELSE rate_limits.last_request END
    RETURNING count
  `);
  const count = Number(rows[0]?.count ?? 1);
  return { allowed: count <= max, count };
}

/**
 * Best-effort client IP. Behind Vercel (or another proxy) the platform sets
 * x-forwarded-for; the first entry is the original client.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}
