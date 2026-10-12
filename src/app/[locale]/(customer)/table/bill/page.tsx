import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { BillDetails } from "@/features/bills/bill-details";
import { PayBillPanel, type PayOptions } from "@/features/bills/pay-bill-panel";
import { LiveRefresh } from "@/features/ordering/live-refresh";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getCustomer } from "@/server/guests/current-customer";
import { realtimeChannels } from "@/server/realtime/channels";
import { isRealtimeEnabled } from "@/server/realtime/realtime";
import { type BillPaymentState, getBillPaymentState } from "@/server/services/bill-payment-service";
import { type BillView, getBillForGuest } from "@/server/services/bill-service";
import { getCustomerTableSession } from "@/server/services/table-session-service";
import { MAX_SPLIT_WAYS } from "@/shared/constants/bills";
import { equalShare } from "@/shared/domain/bill-split";
import { formatMoney } from "@/shared/utils/money";
import { TABLE_COOKIE } from "@/server/table-sessions/table-cookie";

/** Ways to pay what's left, with every amount worked out by the server's rules. */
function payOptions(
  { bill, lines, members }: BillView,
  state: BillPaymentState,
  memberId: string,
  locale: string,
  you: string,
  guestLabel: (position: number) => string,
): PayOptions {
  const money = (minor: number) => formatMoney(minor, bill.currency, locale);
  const uncovered = lines.filter((l) => !state.coveredItemIds.includes(l.id));
  const mine = uncovered.filter((l) => l.memberId === memberId);
  const nothingSplitYet = !state.split && !state.usesItems && state.heldMinor === 0;
  return {
    billId: bill.id,
    remaining: money(state.remainingMinor),
    split: state.split && {
      count: state.split.count,
      free: Array.from({ length: state.split.count }, (_, i) => i + 1)
        .filter((index) => !state.split!.taken.includes(index))
        .map((index) => ({
          index,
          amount: money(equalShare(bill.totalMinor, state.split!.count, index, bill.currency)),
        })),
    },
    splitChoices: nothingSplitYet
      ? Array.from({ length: Math.min(6, MAX_SPLIT_WAYS) - 1 }, (_, i) => i + 2).map((count) => ({
          count,
          amount: money(equalShare(bill.totalMinor, count, 1, bill.currency)),
        }))
      : [],
    picker:
      !state.split && uncovered.length > 0
        ? {
            lines: uncovered,
            people: members.map((m) => ({
              memberId: m.id,
              // Other guests may be strangers: never show their names.
              label: m.id === memberId ? you : guestLabel(m.position),
            })),
            bill: {
              subtotalMinor: bill.subtotalMinor,
              totalMinor: bill.totalMinor,
              heldMinor: state.heldMinor,
              currency: bill.currency,
            },
            initial: mine.map((l) => l.id),
          }
        : null,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  return { robots: { index: false } };
}

/** The table's bill as guests see it (§22): running total, then the final bill. */
export default async function GuestBillPage({ params }: PageProps<"/[locale]/table/bill">) {
  const locale = await resolveLocale(params);
  const customer = await getCustomer();
  const sessionId = (await cookies()).get(TABLE_COOKIE)?.value;
  const view = customer ? await getBillForGuest(customer, sessionId) : null;
  const session = customer ? await getCustomerTableSession(customer, sessionId) : null;
  const state =
    view && view.bill.status !== "open" ? await getBillPaymentState(view.bill.id) : null;
  const t = await getTranslations("Bill");

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        href="/table"
        className="flex items-center gap-1 self-start text-sm text-muted-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("backToMenu")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {!view ? (
        <p className="text-sm text-muted-foreground">{t("noVisit")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t(view.bill.status === "open" ? "guestOpenNote" : "guestFinalNote")}
          </p>
          <BillDetails
            bill={view.bill}
            lines={view.lines}
            locale={locale}
            coveredItemIds={state?.coveredItemIds}
          />
          {view.bill.status === "finalized" && state && state.remainingMinor > 0 && session && (
            <PayBillPanel
              options={payOptions(view, state, session.memberId, locale, t("you"), (n) =>
                t("guestN", { n }),
              )}
            />
          )}
          {view.bill.status === "finalized" && state && state.remainingMinor === 0 && (
            <p role="status" className="rounded-xl bg-muted/50 p-3 text-sm">
              {t("allReserved")}
            </p>
          )}
          {view.bill.status === "paid" && (
            <p role="status" className="rounded-xl bg-primary/10 p-3 text-sm font-medium">
              {t("thanks")}
            </p>
          )}
          <LiveRefresh
            channel={realtimeChannels.session(view.bill.tableSessionId)}
            enabled={isRealtimeEnabled()}
            fallbackSeconds={15}
          />
        </>
      )}
    </div>
  );
}
