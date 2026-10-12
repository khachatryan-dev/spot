"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import { changeOrderStatus } from "@/server/services/order-service";
import type { OrderStatus } from "@/shared/constants/orders";

export async function changeOrderStatusAction(
  restaurantId: string,
  orderId: string,
  to: OrderStatus,
  reason?: string,
) {
  return action(async () => {
    const order = await changeOrderStatus(await requireUser(), restaurantId, orderId, to, {
      reason,
    });
    return { status: order.status };
  });
}
