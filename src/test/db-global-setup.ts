import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { TestProject } from "vitest/node";

import { assertTestDatabase } from "./db";

/** Bring the test database up to the latest migration before integration tests. */
export default async function setup(project: TestProject) {
  // Global setup runs before `test.env` is applied, so read it from the config.
  const url = assertTestDatabase(project.config.env.DATABASE_URL);
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } catch (error) {
    throw new Error(
      `Could not migrate the test database. Is Postgres running and does "spot_test" exist? (see README)`,
      { cause: error },
    );
  } finally {
    await client.end();
  }
}
