import { purgeOldAnalytics } from "@/server/analytics/track";
import { assertCronRequest } from "@/server/http/cron-auth";
import { ok, route } from "@/server/http/response";
import { sendReservationReminders } from "@/server/notifications/reservation-notices";
import { deliverPosOutbox, syncPosStock } from "@/server/services/pos-service";
import { expireOverdueReservations } from "@/server/services/reservation-hold-service";

/**
 * Daily job (§19, §27): release expired holds everywhere, mark unanswered
 * requests as expired, email today's reminders, and catch up on POS
 * deliveries and stock. Screens also do this for what they show,
 * so a daily run (Vercel Hobby's limit) is enough.
 */
export const GET = route(async (request: Request) => {
  assertCronRequest(request);
  const { holdIds, expired } = await expireOverdueReservations();
  const reminded = await sendReservationReminders();
  const purgedEvents = await purgeOldAnalytics();
  const pos = await deliverPosOutbox();
  const posStock = await syncPosStock();
  return ok({
    releasedHolds: holdIds.length,
    expiredReservations: expired.length,
    remindersSent: reminded,
    purgedAnalyticsEvents: purgedEvents,
    posSent: pos.sent,
    posStockChanges: posStock.changed,
  });
});
