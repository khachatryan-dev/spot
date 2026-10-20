import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ClipboardList, QrCode, ReceiptText, UtensilsCrossed } from "lucide-react";
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
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-lg shadow-orange-500/25 motion-safe:animate-in motion-safe:duration-500 motion-safe:zoom-in-90">
          <QrCode className="size-10" aria-hidden />
        </span>
        <h1 className="text-2xl font-bold">{t("noSessionTitle")}</h1>
        <p className="max-w-xs text-muted-foreground">{t("noSessionDescription")}</p>
        {toRate.length > 0 && (
          <Link
            href="/reviews"
            className="mt-2 rounded-xl border bg-card px-4 py-3 text-sm font-medium shadow-sm hover:bg-muted"
          >
            {t("rateVisit", { restaurant: toRate[0]!.restaurantName })}
          </Link>
        )}
        <Link href="/restaurants" className="text-sm font-medium text-primary hover:underline">
          {t("findRestaurants")}
        </Link>
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
      <header className="relative isolate flex flex-col gap-1 overflow-hidden rounded-3xl bg-gradient-to-br from-orange-700 to-rose-600 p-5 text-white shadow-lg shadow-orange-700/20">
        <UtensilsCrossed
          aria-hidden
          className="absolute -right-4 -bottom-4 -z-10 size-28 rotate-12 text-white/10"
        />
        <span className="text-sm text-white">
          {session.restaurant.name} · {session.location.name}
        </span>
        <h1 className="text-3xl font-bold">{t("table", { number: session.table.number })}</h1>
        <span className="self-start rounded-full bg-black/15 px-2.5 py-0.5 text-xs font-medium">
          {t("sessionCode", { code: session.code })}
        </span>
        {myOrders.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/table/orders"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-orange-800 shadow-sm hover:bg-orange-50 dark:bg-card dark:text-orange-300 dark:hover:bg-orange-950/40"
            >
              <ClipboardList className="size-4" aria-hidden />
              {t("myOrders", { count: myOrders.length })}
            </Link>
            <Link
              href="/table/bill"
              className="inline-flex items-center gap-1.5 rounded-xl bg-black/15 px-3 py-2 text-sm font-semibold hover:bg-black/25"
            >
              <ReceiptText className="size-4" aria-hidden />
              {t("bill")}
            </Link>
          </div>
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
