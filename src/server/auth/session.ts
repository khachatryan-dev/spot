import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { auth } from "./auth";

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
export type SessionUser = AuthSession["user"];

/**
 * Current session for this request, or null. Deduplicated per request.
 * A suspended user's existing sessions are treated as signed out.
 */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "active") return null;
  return session;
});
