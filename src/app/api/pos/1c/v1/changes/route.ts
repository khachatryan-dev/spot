import { ok, route } from "@/server/http/response";
import { authenticateExchange, pullChanges } from "@/server/services/pos-exchange-service";

/** 1C collects pending changes, oldest first (docs/pos-1c.md). Bearer exchange token. */
export const GET = route(async (request: Request) => {
  const connection = await authenticateExchange(request);
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50;
  return ok(await pullChanges(connection, { limit }));
});
