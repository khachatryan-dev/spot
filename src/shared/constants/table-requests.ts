/** What a guest can ask for from the table (§18). */
export const TABLE_REQUEST_TYPES = ["waiter", "bill", "water", "assistance", "other"] as const;
export type TableRequestType = (typeof TABLE_REQUEST_TYPES)[number];

export const TABLE_REQUEST_STATUSES = [
  "pending",
  "acknowledged",
  "completed",
  "cancelled",
] as const;
export type TableRequestStatus = (typeof TABLE_REQUEST_STATUSES)[number];

export const OPEN_REQUEST_STATUSES: TableRequestStatus[] = ["pending", "acknowledged"];
