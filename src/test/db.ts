import { sql } from "drizzle-orm";

/** Refuse to run destructive test helpers against anything but a *_test database. */
export function assertTestDatabase(url: string | undefined): string {
  if (!url || !new URL(url).pathname.endsWith("_test")) {
    throw new Error(`Refusing to use non-test database: ${url ? new URL(url).pathname : "unset"}`);
  }
  return url;
}

/** Empty the given tables (and anything referencing them) between tests. */
export async function truncate(
  db: {
    transaction: <T>(
      fn: (tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }) => Promise<T>,
    ) => Promise<T>;
  },
  tables: string[],
) {
  assertTestDatabase(process.env.DATABASE_URL);
  // If something else holds a lock, fail with a clear "lock timeout" error
  // instead of hanging until the hook times out.
  // SET LOCAL + TRUNCATE in one transaction so both run on the same pooled connection.
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '5s'`));
    await tx.execute(sql.raw(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`));
  });
}
