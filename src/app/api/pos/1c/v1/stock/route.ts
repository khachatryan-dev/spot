import { ok, route } from "@/server/http/response";
import {
  authenticateExchange,
  readExchangeBody,
  receiveStock,
} from "@/server/services/pos-exchange-service";

/** 1C uploads its stock; linked dishes follow it. Bearer exchange token. */
export const PUT = route(async (request: Request) => {
  const connection = await authenticateExchange(request);
  return ok(await receiveStock(connection, await readExchangeBody(request)));
});
