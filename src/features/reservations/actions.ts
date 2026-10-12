"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import {
  placeReservationHold,
  releaseReservationHold,
} from "@/server/services/reservation-hold-service";
import {
  cancelMyReservation,
  createReservation,
  updateReservationStatus,
} from "@/server/services/reservation-service";
import { startDepositPayment } from "@/server/services/reservation-deposit-service";
import type { StaffReservationAction } from "@/shared/domain/reservation-status";
import type { CreateReservationInput } from "@/shared/schemas/reservation";

/** Hold a table for the chosen time while the guest fills in their details. */
export async function holdTimeAction(input: {
  restaurantId: string;
  locationId: string;
  startsAt: string;
  partySize: number;
}) {
  return action(async () => {
    const hold = await placeReservationHold(await requireUser(), input);
    return { id: hold.id, expiresAt: hold.expiresAt.toISOString() };
  });
}

/** The guest picked another time or went back: free the table now. */
export async function releaseHoldAction(holdId: string) {
  return action(async () => {
    await releaseReservationHold(await requireUser(), holdId);
    return { ok: true };
  });
}

/** Book the held table. With a deposit, also returns the payment page to send the guest to. */
export async function createReservationAction(input: CreateReservationInput) {
  return action(async () => {
    const user = await requireUser();
    const reservation = await createReservation(user, input);
    const payUrl =
      reservation.status === "pending_payment"
        ? (await startDepositPayment(user, reservation.id)).redirectUrl
        : null;
    return { id: reservation.id, status: reservation.status, payUrl };
  });
}

/** Pay (or retry paying) a booking's deposit: returns the payment page. */
export async function payDepositAction(reservationId: string) {
  return action(async () => startDepositPayment(await requireUser(), reservationId));
}

/** Staff move a reservation along (the service checks role and status). */
export async function reservationActionAction(
  restaurantId: string,
  reservationId: string,
  step: StaffReservationAction,
  reason?: string,
) {
  return action(async () => {
    const reservation = await updateReservationStatus(
      await requireUser(),
      restaurantId,
      reservationId,
      step,
      { reason },
    );
    return { status: reservation.status };
  });
}

/** A guest cancels their own upcoming booking. */
export async function cancelMyReservationAction(reservationId: string) {
  return action(async () => {
    await cancelMyReservation(await requireUser(), reservationId);
    return { ok: true };
  });
}
