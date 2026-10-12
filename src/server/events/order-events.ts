import "server-only";

import { logger } from "@/server/logger";
import { realtimeChannels, type RealtimeHint } from "@/server/realtime/channels";
import { getRealtimePublisher } from "@/server/realtime/realtime";

/*
 * Domain events for orders and table requests (§16 step 11, §28), published
 * after the database commit. Each event is forwarded as a realtime hint to
 * the location's staff channel and the table session's guest channel
 * (ADR 0001), and passed to any in-process listeners (tests, future jobs).
 */

interface EventBase {
  restaurantId: string;
  locationId: string;
  tableSessionId: string;
}

export type OrderEvent =
  | (EventBase & { type: "ORDER_CREATED"; orderId: string; number: number })
  | (EventBase & { type: "ORDER_STATUS_CHANGED"; orderId: string; status: string })
  | (EventBase & { type: "TABLE_REQUEST_CHANGED"; requestId: string; status: string });

type Listener = (event: OrderEvent) => void | Promise<void>;
const listeners = new Set<Listener>();
const log = logger.child({ module: "order-events" });

/** Subscribe (returns an unsubscribe function). */
export function onOrderEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The hint sent over realtime: what changed, never the data itself (§28). */
export function toRealtimeHint(event: OrderEvent): RealtimeHint {
  switch (event.type) {
    case "ORDER_CREATED":
      return { type: event.type, id: event.orderId };
    case "ORDER_STATUS_CHANGED":
      return { type: event.type, id: event.orderId, status: event.status };
    case "TABLE_REQUEST_CHANGED":
      return { type: event.type, id: event.requestId, status: event.status };
  }
}

/** Channels that should hear about an event: staff at the location, guests at the table. */
export const channelsFor = (event: OrderEvent) => [
  realtimeChannels.location(event.restaurantId, event.locationId),
  realtimeChannels.session(event.tableSessionId),
];

/** Publish after commit. Failures are logged, never thrown: the change already happened. */
export async function publishOrderEvent(event: OrderEvent) {
  log.info("Order event", {
    type: event.type,
    restaurantId: event.restaurantId,
    locationId: event.locationId,
  });
  const hint = toRealtimeHint(event);
  const publisher = getRealtimePublisher();
  await Promise.all(channelsFor(event).map((channel) => publisher.publish(channel, hint)));
  for (const listener of listeners) {
    try {
      await listener(event);
    } catch (err) {
      log.error("Order event listener failed", { err, type: event.type });
    }
  }
}
