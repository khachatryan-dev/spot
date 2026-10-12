import { assertCronRequest } from "@/server/http/cron-auth";
import { ok, route } from "@/server/http/response";
import { deliverPosOutbox, syncPosStock } from "@/server/services/pos-service";

/**
 * POS job (§29): retry changes that didn't reach a POS and follow POS stock.
 * New changes are sent right away; this catches up after outages. Schedule
 * it every few minutes on the server (the daily job also runs it).
 */
export const GET = route(async (request: Request) => {
  assertCronRequest(request);
  const delivery = await deliverPosOutbox();
  const stock = await syncPosStock();
  return ok({ ...delivery, stockChanges: stock.changed });
});
