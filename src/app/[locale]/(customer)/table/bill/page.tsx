import { ArrowLeft, CheckCircle2, Hourglass } from "lucide-react";
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

  const money = (minor: number) => (view ? formatMoney(minor, view.bill.currency, locale) : "");
  const bill = view?.bill;
  // The big number: what's left once the bill is final, else the running total.
  const headline =
    bill?.status === "finalized" && state
      ? { label: t("hero.toPay"), amount: money(state.remainingMinor) }
      : bill?.status === "paid"
        ? { label: t("hero.paidAll"), amount: money(bill.totalMinor) }
        : { label: t("hero.running"), amount: money(bill?.totalMinor ?? 0) };
  const paidShare = bill && bill.totalMinor > 0 ? Math.min(1, bill.paidMinor / bill.totalMinor) : 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        href="/table"
        className="flex items-center gap-1 self-start rounded-full bg-card px-3 py-1.5 text-sm font-medium shadow-sm ring-1 ring-border"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("backToMenu")}
      </Link>
      {!view || !bill ? (
        <>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("noVisit")}</p>
        </>
      ) : (
        <>
          {/* Banking-style header: the one number that matters, and how much is paid */}
          <div
            className={`flex flex-col gap-3 rounded-3xl bg-gradient-to-br p-5 text-white shadow-lg ${
              bill.status === "paid"
                ? "from-emerald-700 to-teal-700 shadow-emerald-700/20"
                : "from-orange-700 to-rose-600 shadow-orange-700/20"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-base font-semibold">
                {t("title")} · {t("hero.table", { number: view.tableNumber })}
              </h1>
              <span className="rounded-full bg-black/20 px-2.5 py-0.5 text-xs font-semibold">
                {t(`status.${bill.status}`)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm">{headline.label}</span>
              <span className="text-4xl font-bold tracking-tight tabular-nums">
                {headline.amount}
              </span>
            </div>
            {bill.status !== "open" && (
              <div className="flex flex-col gap-1">
                <div aria-hidden className="h-2 overflow-hidden rounded-full bg-black/20">
                  <div
                    className="h-full rounded-full bg-white transition-[width] duration-700"
                    style={{ width: `${paidShare * 100}%` }}
                  />
                </div>
                <span className="text-xs">
                  {t("hero.progress", {
                    paid: money(bill.paidMinor),
                    total: money(bill.totalMinor),
                  })}
                </span>
              </div>
            )}
          </div>

          <p className="px-1 text-sm text-muted-foreground">
            {t(bill.status === "open" ? "guestOpenNote" : "guestFinalNote")}
          </p>

          {bill.status === "finalized" && state && state.remainingMinor > 0 && session && (
            <PayBillPanel
              options={payOptions(view, state, session.memberId, locale, t("you"), (n) =>
                t("guestN", { n }),
              )}
            />
          )}
          {bill.status === "finalized" && state && state.remainingMinor === 0 && (
            <p
              role="status"
              className="flex items-center gap-3 rounded-3xl bg-amber-50 p-4 text-sm font-medium ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-800"
            >
              <Hourglass
                className="size-5 shrink-0 text-amber-700 dark:text-amber-300"
                aria-hidden
              />
              {t("allReserved")}
            </p>
          )}
          {bill.status === "paid" && (
            <p
              role="status"
              className="flex items-center gap-3 rounded-3xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-100 motion-safe:animate-in motion-safe:zoom-in-95 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50"
            >
              <CheckCircle2
                className="size-6 shrink-0 text-emerald-700 dark:text-emerald-300"
                aria-hidden
              />
              {t("thanks")}
            </p>
          )}

          <BillDetails
            bill={bill}
            lines={view.lines}
            locale={locale}
            coveredItemIds={state?.coveredItemIds}
          />
          <LiveRefresh
            channel={realtimeChannels.session(bill.tableSessionId)}
            enabled={isRealtimeEnabled()}
            fallbackSeconds={15}
          />
        </>
      )}
    </div>
  );
}
