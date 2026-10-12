// Apply database migrations before a deploy's build (vercel.json).
// Fails the build loudly; `drizzle-kit migrate` can exit 0 on errors.
// Runs only for the branch that deploys to the main environment, so a preview
// of an unmerged branch never changes the shared database.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const target = process.env.VERCEL_ENV;
if (target && target !== "production") {
  console.log(`[migrate] Skipped for a ${target} deploy.`);
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set.");
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("[migrate] Database is up to date.");
} catch (error) {
  console.error("[migrate] Migration failed:", error);
  process.exitCode = 1;
} finally {
  await client.end();
}
