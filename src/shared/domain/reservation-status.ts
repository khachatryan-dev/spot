import type { RestaurantPermission } from "@/shared/auth/permissions";
import type { ReservationStatus } from "@/shared/constants/reservations";

/*
 * Reservation status rules (§19). Anything not listed is not allowed.
 * Staff act through named actions; each says where it may start, where it
 * leads and which permission it needs.
 */

export const STAFF_RESERVATION_ACTIONS = [
  "confirm",
  "decline",
  "arrive",
  "seat",
  "complete",
  "no_show",
  "cancel",
] as const;
export type StaffReservationAction = (typeof STAFF_RESERVATION_ACTIONS)[number];

interface ActionRule {
  from: readonly ReservationStatus[];
  to: ReservationStatus;
  permission: RestaurantPermission;
  /** The guest is told why (decline, cancel). */
  reasonRequired?: boolean;
  /** Only once the reservation's start time has passed (no-show). */
  afterStart?: boolean;
}

export const RESERVATION_ACTIONS: Record<StaffReservationAction, ActionRule> = {
  confirm: { from: ["pending_confirmation"], to: "confirmed", permission: "reservation:manage" },
  decline: {
    from: ["pending_confirmation"],
    to: "cancelled",
    permission: "reservation:manage",
    reasonRequired: true,
  },
  arrive: { from: ["confirmed"], to: "arrived", permission: "reservation:seat" },
  seat: { from: ["confirmed", "arrived"], to: "seated", permission: "reservation:seat" },
  complete: { from: ["seated"], to: "completed", permission: "reservation:seat" },
  no_show: {
    from: ["confirmed"],
    to: "no_show",
    permission: "reservation:manage",
    afterStart: true,
  },
  cancel: {
    from: ["pending_payment", "confirmed", "arrived"],
    to: "cancelled",
    permission: "reservation:manage",
    reasonRequired: true,
  },
};

/** Statuses that end a reservation; its table is released. */
export const FINAL_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  "completed",
  "cancelled",
  "no_show",
  "expired",
];

/** Why an action can't be taken now, or null if it can. */
export function actionBlocker(
  action: StaffReservationAction,
  reservation: { status: ReservationStatus; startsAt: Date },
  now: Date,
): "status" | "tooEarly" | null {
  const rule = RESERVATION_ACTIONS[action];
  if (!rule.from.includes(reservation.status)) return "status";
  if (rule.afterStart && now < reservation.startsAt) return "tooEarly";
  return null;
}

/** Actions a person with these permissions can take on a reservation now. */
export function availableActions(
  reservation: { status: ReservationStatus; startsAt: Date },
  can: (permission: RestaurantPermission) => boolean,
  now: Date,
): StaffReservationAction[] {
  return STAFF_RESERVATION_ACTIONS.filter(
    (action) =>
      can(RESERVATION_ACTIONS[action].permission) &&
      actionBlocker(action, reservation, now) === null,
  );
}

/** Guests may cancel their own booking until it starts. */
export const CUSTOMER_CANCELLABLE: readonly ReservationStatus[] = [
  "pending_payment",
  "pending_confirmation",
  "confirmed",
];

export const canCustomerCancel = (
  reservation: { status: ReservationStatus; startsAt: Date },
  now: Date,
) => CUSTOMER_CANCELLABLE.includes(reservation.status) && now < reservation.startsAt;
