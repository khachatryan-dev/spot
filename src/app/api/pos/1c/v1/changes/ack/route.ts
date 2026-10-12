import { ok, route } from "@/server/http/response";
import {
  acknowledgeChanges,
  authenticateExchange,
  readExchangeBody,
} from "@/server/services/pos-exchange-service";

/** 1C confirms (or refuses) the changes it collected. Bearer exchange token. */
export const POST = route(async (request: Request) => {
  const connection = await authenticateExchange(request);
  return ok(await acknowledgeChanges(connection, await readExchangeBody(request)));
});
