/** Review states (§24). */
export const REVIEW_STATUSES = ["pending", "published", "hidden", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** What a review is about: a completed reservation, or a table visit with served orders. */
export const REVIEW_SUBJECTS = ["reservation", "visit"] as const;
export type ReviewSubject = (typeof REVIEW_SUBJECTS)[number];

/** How long after the visit a review can be written. */
export const REVIEW_WINDOW_DAYS = 30;
export const MAX_REVIEW_COMMENT = 2000;
