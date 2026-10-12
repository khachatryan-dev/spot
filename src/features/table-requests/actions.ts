"use server";

import { cookies } from "next/headers";

import { requireUser } from "@/server/auth/guards";
import { getCustomer } from "@/server/guests/current-customer";
import { action } from "@/server/http/response";
import {
  cancelTableRequest,
  createTableRequest,
  updateTableRequest,
} from "@/server/services/table-request-service";
import { TABLE_COOKIE } from "@/server/table-sessions/table-cookie";
import type { TableRequestType } from "@/shared/constants/table-requests";
import { AppError } from "@/shared/errors";

async function customerAndSession() {
  const customer = await getCustomer();
  if (!customer)
    throw new AppError("NOT_FOUND", "Your table visit has ended. Scan the QR code again.");
  return { customer, sessionId: (await cookies()).get(TABLE_COOKIE)?.value };
}

export async function requestServiceAction(type: TableRequestType) {
  return action(async () => {
    const { customer, sessionId } = await customerAndSession();
    const request = await createTableRequest(customer, sessionId, { type });
    return { id: request.id };
  });
}

export async function cancelServiceRequestAction(requestId: string) {
  return action(async () => {
    const { customer, sessionId } = await customerAndSession();
    await cancelTableRequest(customer, sessionId, requestId);
    return { ok: true };
  });
}

export async function updateServiceRequestAction(
  restaurantId: string,
  requestId: string,
  to: "acknowledged" | "completed",
) {
  return action(async () => {
    await updateTableRequest(await requireUser(), restaurantId, requestId, to);
    return { ok: true };
  });
}
