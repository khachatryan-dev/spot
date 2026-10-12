/** Table states (§12). Day-to-day occupancy comes from table sessions (Day 33). */
export const TABLE_STATUSES = [
  "available",
  "reserved",
  "occupied",
  "blocked",
  "out_of_service",
] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const TABLE_TYPES = ["standard", "bar", "booth", "outdoor", "private"] as const;
export type TableType = (typeof TABLE_TYPES)[number];

export const MAX_TABLE_CAPACITY = 50;
