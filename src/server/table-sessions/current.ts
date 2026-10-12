import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getCustomer } from "@/server/guests/current-customer";
import { getCustomerTableSession } from "@/server/services/table-session-service";

import { TABLE_COOKIE } from "./table-cookie";

/** The table session this visitor is at, or null (not a member, closed, idle or no cookie). */
export const getCurrentTableSession = cache(async () => {
  const customer = await getCustomer();
  if (!customer) return null;
  const sessionId = (await cookies()).get(TABLE_COOKIE)?.value;
  return getCustomerTableSession(customer, sessionId);
});
