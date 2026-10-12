import postgres from "postgres";

/** Start every run from a clean test database (also resets auth rate limits). */
export default async function globalSetup() {
  const sql = postgres("postgresql://spot:spot@localhost:5432/spot_test", {
    max: 1,
    onnotice: () => {},
  });
  try {
    await sql`TRUNCATE users, restaurants, guests, verifications, rate_limits CASCADE`;
  } finally {
    await sql.end();
  }
}
