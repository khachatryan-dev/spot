import type { RestaurantStatus } from "@/shared/constants/restaurants";

export type StatusActor = "owner" | "platform_admin";

/**
 * Allowed restaurant status changes and who may make them (§10).
 * Anything not listed is rejected.
 */
const TRANSITIONS: Record<RestaurantStatus, Partial<Record<RestaurantStatus, StatusActor[]>>> = {
  draft: { pending_review: ["owner"], closed: ["owner", "platform_admin"] },
  pending_review: {
    active: ["platform_admin"], // approve
    draft: ["owner", "platform_admin"], // owner withdraws / admin rejects with a reason
    closed: ["owner", "platform_admin"],
  },
  active: { suspended: ["platform_admin"], closed: ["owner", "platform_admin"] },
  suspended: { active: ["platform_admin"], closed: ["owner", "platform_admin"] },
  closed: {},
};

export function canTransition(from: RestaurantStatus, to: RestaurantStatus, actor: StatusActor) {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

/** Only active restaurants are visible to the public (§10). */
export const isPubliclyVisible = (status: RestaurantStatus) => status === "active";
