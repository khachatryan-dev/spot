import type { ReviewStatus } from "@/shared/constants/reviews";

/*
 * Moderation decisions (§24 "Admin can moderate"). Rejecting is final;
 * hiding can be undone; keeping leaves the review up and clears a report.
 */

export const MODERATION_DECISIONS = ["keep", "hide", "reject", "restore"] as const;
export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];

const RULES: Record<
  ModerationDecision,
  { from: ReviewStatus[]; to: ReviewStatus; reasonRequired: boolean }
> = {
  keep: { from: ["published", "pending"], to: "published", reasonRequired: false },
  hide: { from: ["published", "pending"], to: "hidden", reasonRequired: true },
  reject: { from: ["published", "pending", "hidden"], to: "rejected", reasonRequired: true },
  restore: { from: ["hidden"], to: "published", reasonRequired: false },
};

export const moderationRule = (decision: ModerationDecision) => RULES[decision];

/** Decisions an admin can take on a review in this state. */
export const availableDecisions = (status: ReviewStatus): ModerationDecision[] =>
  MODERATION_DECISIONS.filter((d) => RULES[d].from.includes(status));
