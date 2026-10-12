"use server";

import { cookies } from "next/headers";

import { requireUser } from "@/server/auth/guards";
import { getCustomer } from "@/server/guests/current-customer";
import { action } from "@/server/http/response";
import { closeTableSession, leaveTableSession } from "@/server/services/table-session-service";
import { TABLE_COOKIE } from "@/server/table-sessions/table-cookie";

/** Guest/customer leaves their table. */
export async function leaveTableAction() {
  return action(async () => {
    const store = await cookies();
    const sessionId = store.get(TABLE_COOKIE)?.value;
    const customer = await getCustomer();
    if (customer && sessionId) await leaveTableSession(customer, sessionId);
    store.delete(TABLE_COOKIE);
    return { ok: true };
  });
}

/** Staff end a visit. */
export async function closeTableSessionAction(restaurantId: string, sessionId: string) {
  return action(async () => {
    await closeTableSession(await requireUser(), restaurantId, sessionId);
    return { ok: true };
  });
}
