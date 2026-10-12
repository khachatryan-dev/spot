/**
 * Realtime channel names (ADR 0001). Kept in one place so publishers and the
 * token issuer (which limits who may subscribe to what) always agree.
 */
export const realtimeChannels = {
  /** Staff screens for one location: order board, kitchen, table requests. */
  location: (restaurantId: string, locationId: string) =>
    `restaurant:${restaurantId}:location:${locationId}`,
  /** Guests at one table visit: their order statuses and table requests. */
  session: (tableSessionId: string) => `session:${tableSessionId}`,
};

/** What travels over realtime: a hint to re-fetch, never data (§28). */
export interface RealtimeHint {
  type: string;
  /** Id of what changed (order, request) — no prices, items or personal data. */
  id: string;
  status?: string;
}
