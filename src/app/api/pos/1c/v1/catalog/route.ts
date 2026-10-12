import { ok, route } from "@/server/http/response";
import {
  authenticateExchange,
  readExchangeBody,
  receiveCatalog,
} from "@/server/services/pos-exchange-service";

/** 1C uploads its menu and tables. Bearer exchange token. */
export const PUT = route(async (request: Request) => {
  const connection = await authenticateExchange(request);
  return ok(await receiveCatalog(connection, await readExchangeBody(request)));
});
