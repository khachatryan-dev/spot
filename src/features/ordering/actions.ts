"use server";

import { cookies } from "next/headers";

import { getCustomer } from "@/server/guests/current-customer";
import { action } from "@/server/http/response";
import { cancelOrderAsCustomer, createOrder } from "@/server/services/order-service";
import { TABLE_COOKIE } from "@/server/table-sessions/table-cookie";
import { AppError } from "@/shared/errors";
import type { OrderRequest } from "@/shared/schemas/order";

/** Place the guest's cart as an order. Prices are never taken from the browser. */
export async function placeOrderAction(input: OrderRequest) {
  return action(async () => {
    const customer = await getCustomer();
    if (!customer)
      throw new AppError("NOT_FOUND", "Your table visit has ended. Scan the QR code again.");
    const sessionId = (await cookies()).get(TABLE_COOKIE)?.value;
    const order = await createOrder(customer, sessionId, input);
    return { id: order.id, number: order.number };
  });
}

/** A guest cancels their own order (only before the kitchen accepts it). */
export async function cancelMyOrderAction(orderId: string) {
  return action(async () => {
    const customer = await getCustomer();
    if (!customer) throw new AppError("NOT_FOUND", "Order not found.");
    const sessionId = (await cookies()).get(TABLE_COOKIE)?.value;
    await cancelOrderAsCustomer(customer, sessionId, orderId);
    return { ok: true };
  });
}
