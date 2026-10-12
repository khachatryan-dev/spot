/** Reservation states (§19). */
export const RESERVATION_STATUSES = [
  "pending_payment",
  "pending_confirmation",
  "confirmed",
  "arrived",
  "seated",
  "completed",
  "cancelled",
  "no_show",
  "expired",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** States in which a reservation keeps its table (it has an unreleased hold). */
export const ACTIVE_RESERVATION_STATUSES = [
  "pending_payment",
  "pending_confirmation",
  "confirmed",
  "arrived",
  "seated",
] as const satisfies readonly ReservationStatus[];

/** How a location accepts new reservations: at once, or after staff review. */
export const RESERVATION_CONFIRMATION_MODES = ["auto", "manual"] as const;
export type ReservationConfirmationMode = (typeof RESERVATION_CONFIRMATION_MODES)[number];

/** Location settings bounds (minutes / days). */
export const RESERVATION_DURATION = { min: 30, max: 360, default: 120 } as const;
export const RESERVATION_MIN_NOTICE = { min: 0, max: 7 * 24 * 60, default: 60 } as const;
export const RESERVATION_MAX_DAYS_AHEAD = { min: 1, max: 365, default: 30 } as const;

/** How long a guest may keep a slot while finishing the reservation form. */
export const RESERVATION_HOLD_MINUTES = 10;

/** Reservation times are offered every this many minutes from each opening. */
export const RESERVATION_SLOT_STEP_MINUTES = 30;

/** Deposit to confirm a booking: none, an amount per guest, or one per booking. */
export const RESERVATION_DEPOSIT_TYPES = ["none", "per_guest", "per_booking"] as const;
export type ReservationDepositType = (typeof RESERVATION_DEPOSIT_TYPES)[number];

/** Upper bound for a deposit setting, in minor units (1 000 000 ֏). */
export const MAX_DEPOSIT_MINOR = 100_000_000;
/** A guest cancelling at least this many hours ahead gets the deposit back. */
export const REFUND_CUTOFF_HOURS = { min: 0, max: 168, default: 24 } as const;
/** How long the table stays held while the guest pays the deposit. */
export const DEPOSIT_PAYMENT_MINUTES = 15;
