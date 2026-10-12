import { cookies } from "next/headers";
import { z } from "zod";

import { getSession } from "@/server/auth/session";
import { getCustomer } from "@/server/guests/current-customer";
import { ok, route } from "@/server/http/response";
import { assertSameOrigin } from "@/server/http/same-origin";
import { clientIp, hitRateLimit } from "@/server/rate-limit/rate-limit";
import { authorizeRealtimeChannel, createChannelToken } from "@/server/realtime/tokens";
import { TABLE_COOKIE } from "@/server/table-sessions/table-cookie";
import { env } from "@/shared/config/env";
import { AppError } from "@/shared/errors";

const bodySchema = z.object({ channel: z.string().max(200) });
// Each open screen asks once on connect and again about hourly; this is generous.
const TOKEN_LIMIT = { max: 60, windowMs: 60_000 };

/** POST { channel } → a subscribe-only Ably token request for that channel. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  if (!(await hitRateLimit(`realtime:${clientIp(request)}`, TOKEN_LIMIT)).allowed) {
    throw new AppError("RATE_LIMITED", "Too many requests.");
  }
  if (!env.ABLY_API_KEY) throw new AppError("RESOURCE_UNAVAILABLE", "Realtime is not configured.");
  const { channel } = bodySchema.parse(await request.json().catch(() => ({})));

  const session = await getSession();
  await authorizeRealtimeChannel(channel, {
    user: session?.user ?? null,
    customer: await getCustomer(),
    tableSessionId: (await cookies()).get(TABLE_COOKIE)?.value,
  });
  return ok(await createChannelToken(env.ABLY_API_KEY, channel));
});
