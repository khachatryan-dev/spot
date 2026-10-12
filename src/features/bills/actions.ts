"use server";

import { cookies } from "next/headers";

import { requireUser } from "@/server/auth/guards";
import { getCustomer } from "@/server/guests/current-customer";
import { action } from "@/server/http/response";
import {
  type BillPaymentRequest,
  recordBillPayment,
  startGuestBillPayment,
} from "@/server/services/bill-payment-service";
import { finalizeBill, voidBill } from "@/server/services/bill-service";
import { TABLE_COOKIE } from "@/server/table-sessions/table-cookie";
import { AppError } from "@/shared/errors";

/** Lock the visit's bill for payment (bill:manage). */
export async function finalizeBillAction(restaurantId: string, sessionId: string) {
  return action(async () => {
    const { bill } = await finalizeBill(await requireUser(), restaurantId, sessionId);
    return { status: bill.status };
  });
}

/** Cancel an unpaid bill so the visit gets a fresh one (bill:manage). */
export async function voidBillAction(restaurantId: string, billId: string, reason: string) {
  return action(async () => {
    await voidBill(await requireUser(), restaurantId, billId, reason);
    return { ok: true };
  });
}

/** A guest pays (part of) the table's bill online; returns the payment page. */
export async function payBillAction(billId: string, request: BillPaymentRequest) {
  return action(async () => {
    const customer = await getCustomer();
    if (!customer) throw new AppError("NOT_FOUND", "Your table visit has ended.");
    const sessionId = (await cookies()).get(TABLE_COOKIE)?.value;
    return startGuestBillPayment(customer, sessionId, billId, request);
  });
}

/** Staff take cash or a card-terminal payment (payment:confirm). */
export async function recordBillPaymentAction(
  restaurantId: string,
  billId: string,
  request: BillPaymentRequest & { method: "cash" | "card_terminal" },
) {
  return action(async () => {
    const { bill } = await recordBillPayment(await requireUser(), restaurantId, billId, request);
    return { status: bill.status };
  });
}
