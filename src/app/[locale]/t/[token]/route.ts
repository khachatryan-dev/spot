import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";

import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { track } from "@/server/analytics/track";
import { getSession } from "@/server/auth/session";
import { ensureGuest } from "@/server/guests/current-customer";
import { logger } from "@/server/logger";
import { clientIp, hitRateLimit } from "@/server/rate-limit/rate-limit";
import { resolveQrToken } from "@/server/services/qr-service";
import { joinTableSession } from "@/server/services/table-session-service";
import { TABLE_COOKIE, tableCookieOptions } from "@/server/table-sessions/table-cookie";

const log = logger.child({ module: "qr-scan" });

/** Generous: a whole restaurant often shares one Wi-Fi IP. Stops scripted guest creation. */
const SCAN_LIMIT = { max: 60, windowMs: 60_000 };

/**
 * A guest scanned a table QR code (§13):
 * token → restaurant/location/table → join or start the table session → /table.
 * Cookies can only be set here (a Route Handler), not while rendering a page.
 */
export async function GET(request: Request, context: RouteContext<"/[locale]/t/[token]">) {
  const { locale: raw, token } = await context.params;
  const locale = routing.locales.find((l) => l === raw) ?? routing.defaultLocale;
  const go = (path: string) =>
    NextResponse.redirect(new URL(localizePath(path, locale), request.url), 303);

  const ip = clientIp(request);
  if (!(await hitRateLimit(`scan:${ip}`, SCAN_LIMIT)).allowed) {
    log.warn("Scan rate limit hit", { ip });
    return go("/table/unavailable?reason=busy");
  }

  const qr = await resolveQrToken(token);
  // Unknown, revoked or expired codes all look the same to the visitor.
  if (!qr) return go("/table/unavailable");

  try {
    const session = await getSession();
    const customer = session
      ? ({ type: "user", user: session.user } as const)
      : ({ type: "guest", guest: await ensureGuest() } as const);
    const tableSession = await joinTableSession(customer, qr);
    (await cookies()).set(TABLE_COOKIE, tableSession.id, tableCookieOptions);
    const identity =
      customer.type === "user" ? `user:${customer.user.id}` : `guest:${customer.guest.id}`;
    after(() =>
      track("qr_scanned", { restaurantId: qr.restaurantId, locationId: qr.locationId, identity }),
    );
    return go("/table");
  } catch (err) {
    log.error("Failed to join table session", {
      err,
      restaurantId: qr.restaurantId,
      tableId: qr.tableId,
    });
    return go("/table/unavailable");
  }
}
