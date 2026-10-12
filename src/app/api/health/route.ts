import { sql } from "drizzle-orm";

import { db } from "@/server/db/client";
import { ok } from "@/server/http/response";

/** Liveness + database check for local dev and deploy health probes. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return ok({ status: "ok", database: "ok" });
  } catch {
    // Never expose raw database errors (§33).
    return Response.json(
      { data: null, error: { code: "RESOURCE_UNAVAILABLE", message: "Database unavailable" } },
      { status: 503 },
    );
  }
}
