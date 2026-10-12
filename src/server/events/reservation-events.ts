import "server-only";

import { logger } from "@/server/logger";
import { realtimeChannels } from "@/server/realtime/channels";
import { getRealtimePublisher } from "@/server/realtime/realtime";

/*
 * Reservation events (§27, §28), published after the database commit as a
 * realtime hint on the location's staff channel, so the reservations screen
 * refreshes. The hint carries the id and status only — never guest details.
 */

export interface ReservationEvent {
  type: "RESERVATION_CREATED" | "RESERVATION_STATUS_CHANGED";
  restaurantId: string;
  locationId: string;
  reservationId: string;
  status: string;
}

const log = logger.child({ module: "reservation-events" });

/** The publisher logs failures and never throws: the change already happened. */
export async function publishReservationEvent(event: ReservationEvent) {
  log.info("Reservation event", {
    type: event.type,
    restaurantId: event.restaurantId,
    locationId: event.locationId,
  });
  await getRealtimePublisher().publish(
    realtimeChannels.location(event.restaurantId, event.locationId),
    { type: event.type, id: event.reservationId, status: event.status },
  );
}
