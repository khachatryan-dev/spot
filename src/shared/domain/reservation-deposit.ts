import type { ReservationDepositType } from "@/shared/constants/reservations";

/** Deposit for a party under a location's rule (minor units); 0 = none. */
export function depositFor(
  rule: { depositType: ReservationDepositType; depositMinor: number },
  partySize: number,
): number {
  if (rule.depositType === "per_guest") return rule.depositMinor * partySize;
  if (rule.depositType === "per_booking") return rule.depositMinor;
  return 0;
}

/** A guest cancelling at `now` gets the deposit back if it's at least `cutoffHours` before the start. */
export const isRefundableCancellation = (startsAt: Date, cutoffHours: number, now: Date) =>
  now.getTime() <= startsAt.getTime() - cutoffHours * 3_600_000;
