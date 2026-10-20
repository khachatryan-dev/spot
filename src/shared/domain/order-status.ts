import type { RestaurantPermission } from "@/shared/auth/permissions";
import type { OrderStatus } from "@/shared/constants/orders";

/*
 * Order status rules (§16, §17). Anything not listed is not allowed.
 * Each step names the permission(s) that allow it (any one is enough).
 */

type Step = { to: OrderStatus; permissions: RestaurantPermission[]; reasonRequired?: boolean };

const CANCEL: Step = { to: "cancelled", permissions: ["order:cancel"], reasonRequired: true };
const REJECT: Step = { to: "rejected", permissions: ["order:prepare"], reasonRequired: true };

export const ORDER_TRANSITIONS: Record<OrderStatus, Step[]> = {
  submitted: [
    { to: "received", permissions: ["order:prepare", "order:serve"] },
    { to: "accepted", permissions: ["order:prepare"] },
    REJECT,
    CANCEL,
  ],
  received: [{ to: "accepted", permissions: ["order:prepare"] }, REJECT, CANCEL],
  accepted: [
    { to: "preparing", permissions: ["order:prepare"] },
    // Quick items (drinks) can go straight to ready.
    { to: "ready", permissions: ["order:prepare"] },
    CANCEL,
  ],
  preparing: [{ to: "ready", permissions: ["order:prepare"] }, CANCEL],
  ready: [{ to: "served", permissions: ["order:serve"] }, CANCEL],
  served: [{ to: "completed", permissions: ["order:serve"] }],
  completed: [],
  cancelled: [],
  rejected: [],
};

export function findTransition(from: OrderStatus, to: OrderStatus): Step | null {
  return ORDER_TRANSITIONS[from].find((step) => step.to === to) ?? null;
}

/** Statuses `role permissions` may move an order to next. */
export function nextStatuses(
  from: OrderStatus,
  can: (p: RestaurantPermission) => boolean,
): OrderStatus[] {
  return ORDER_TRANSITIONS[from]
    .filter((step) => step.permissions.some(can))
    .map((step) => step.to);
}

/** Guests may cancel their own order only before the kitchen has accepted it. */
export const CUSTOMER_CANCELLABLE: OrderStatus[] = ["submitted", "received"];

export const isFinalStatus = (status: OrderStatus) => ORDER_TRANSITIONS[status].length === 0;

/** What the guest's progress tracker shows: sent → accepted → cooking → ready → served. */
export const GUEST_PROGRESS_STEPS = ["sent", "accepted", "preparing", "ready", "served"] as const;
export type GuestProgressStep = (typeof GUEST_PROGRESS_STEPS)[number];

/** Index into GUEST_PROGRESS_STEPS, or null for cancelled / rejected orders. */
export function guestProgress(status: OrderStatus): number | null {
  switch (status) {
    case "submitted":
    case "received":
      return 0;
    case "accepted":
      return 1;
    case "preparing":
      return 2;
    case "ready":
      return 3;
    case "served":
    case "completed":
      return 4;
    case "cancelled":
    case "rejected":
      return null;
  }
}
