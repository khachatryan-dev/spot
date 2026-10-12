/** Postgres error from a Drizzle query (the driver error is wrapped in `cause`). */
function pgError(error: unknown): { code?: string; constraint_name?: string } | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const cause = (error as { cause?: unknown }).cause;
  return (cause ?? error) as { code?: string; constraint_name?: string };
}

/** True for a unique-constraint violation, optionally on a specific constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = pgError(error);
  return pg?.code === "23505" && (!constraint || pg.constraint_name === constraint);
}

/** True for an exclusion-constraint violation (e.g. overlapping reservation holds). */
export function isExclusionViolation(error: unknown, constraint?: string): boolean {
  const pg = pgError(error);
  return pg?.code === "23P01" && (!constraint || pg.constraint_name === constraint);
}
