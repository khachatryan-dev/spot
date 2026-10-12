export const TABLE_SESSION_STATUSES = ["open", "closed"] as const;
export type TableSessionStatus = (typeof TABLE_SESSION_STATUSES)[number];

/** Why a session ended: staff closed it, the bill was paid, or it went idle. */
export const TABLE_SESSION_CLOSE_REASONS = ["staff", "paid", "expired"] as const;
export type TableSessionCloseReason = (typeof TABLE_SESSION_CLOSE_REASONS)[number];

/** A session with no activity for this long is finished; the next scan starts a new one. */
export const TABLE_SESSION_IDLE_HOURS = 8;
