import type { Metadata } from "next";
import { cookies } from "next/headers";
import { QrCode } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { MenuView } from "@/features/customer-menu/menu-view";
import { LiveRefresh } from "@/features/ordering/live-refresh";
import { RequestButtons } from "@/features/table-requests/request-buttons";
import { LeaveTableButton } from "@/features/table-session/leave-table-button";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { listReviewOpportunities } from "@/server/services/review-service";
import { getCustomer } from "@/server/guests/current-customer";
import { getCustomerMenus } from "@/server/services/customer-menu-service";
import { getCustomerOrders } from "@/server/services/order-service";
import { listTableRequestsForCustomer } from "@/server/services/table-request-service";
import { getCurrentTableSession } from "@/server/table-sessions/current";
import { TABLE_COOKIE } from "@/server/table-sessions/table-cookie";
import { realtimeChannels } from "@/server/realtime/channels";
import { isRealtimeEnabled } from "@/server/realtime/realtime";

export async function generateMetadata(): Promise<Metadata> {
  return { robots: { index: false } };
}

/** The guest's table: who they're with and (Day 35) the menu. */
export default async function TablePage({ params }: PageProps<"/[locale]/table">) {
  const locale = await resolveLocale(params);
  const session = await getCurrentTableSession();
  const t = await getTranslations("TableSession");

  if (!session) {
    const visitor = await getCustomer();
    const toRate = visitor ? await listReviewOpportunities(visitor) : [];
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <QrCode className="size-12 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">{t("noSessionTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("noSessionDescription")}</p>
        {toRate.length > 0 && (
          <Link
            href="/reviews"
            className="mt-4 rounded-xl border px-4 py-3 text-sm font-medium hover:bg-muted"
          >
            {t("rateVisit", { restaurant: toRate[0]!.restaurantName })}
          </Link>
        )}
      </div>
    );
  }

  const customer = await getCustomer();
  const sessionCookie = (await cookies()).get(TABLE_COOKIE)?.value;
  const openRequests = customer ? await listTableRequestsForCustomer(customer, sessionCookie) : [];
  const myOrders =
    (customer && (await getCustomerOrders(customer, (await cookies()).get(TABLE_COOKIE)?.value))) ||
    [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1 rounded-2xl bg-muted/40 p-4">
        <span className="text-sm text-muted-foreground">
          {session.restaurant.name} · {session.location.name}
        </span>
        <h1 className="text-2xl font-semibold">{t("table", { number: session.table.number })}</h1>
        <span className="text-xs text-muted-foreground">
          {t("sessionCode", { code: session.code })}
        </span>
        {myOrders.length > 0 && (
          <Link
            href="/table/orders"
            className="mt-1 self-start text-sm font-medium underline-offset-4 hover:underline"
          >
            {t("myOrders", { count: myOrders.length })}
          </Link>
        )}
        {myOrders.length > 0 && (
          <Link
            href="/table/bill"
            className="self-start text-sm font-medium underline-offset-4 hover:underline"
          >
            {t("bill")}
          </Link>
        )}
      </header>
      <RequestButtons open={openRequests} />
      <LiveRefresh
        channel={realtimeChannels.session(session.sessionId)}
        enabled={isRealtimeEnabled()}
        fallbackSeconds={15}
      />
      <MenuView
        menus={await getCustomerMenus(session.restaurant.id, session.location.id, locale)}
        currency={session.restaurant.currency}
        sessionId={session.sessionId}
      />
      <div className="mt-auto flex justify-center pt-8">
        <LeaveTableButton />
      </div>
    </div>
  );
}
