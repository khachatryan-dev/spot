import { ArrowLeft } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { BillActions } from "@/features/bills/bill-actions";
import { BillDetails } from "@/features/bills/bill-details";
import { RecordPaymentPanel } from "@/features/bills/record-payment-panel";
import { LiveRefresh } from "@/features/ordering/live-refresh";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requireUser } from "@/server/auth/guards";
import { getRestaurantAccess } from "@/server/policies/restaurant-access";
import { realtimeChannels } from "@/server/realtime/channels";
import { isRealtimeEnabled } from "@/server/realtime/realtime";
import { getBillPaymentState } from "@/server/services/bill-payment-service";
import { getBillForStaff } from "@/server/services/bill-service";
import { equalShare } from "@/shared/domain/bill-split";
import { formatMoney } from "@/shared/utils/money";
import { roleHasPermission } from "@/shared/auth/permissions";

/** A table visit's bill for staff (bill:read); finalize and void with bill:manage. */
export default async function StaffBillPage({
  params,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/bills/[sessionId]">) {
  const locale = await resolveLocale(params);
  const { restaurantId, sessionId } = await params;
  const { view, canManage, canTakePayments, state } = await guardPage(locale, async () => {
    const user = await requireUser();
    const view = await getBillForStaff(user, restaurantId, sessionId);
    const access = await getRestaurantAccess(user.id, restaurantId);
    const can = (p: Parameters<typeof roleHasPermission>[1]) =>
      !!access && roleHasPermission(access.role, p);
    const state = view.bill.status === "open" ? null : await getBillPaymentState(view.bill.id);
    return {
      view,
      state,
      canManage: can("bill:manage"),
      canTakePayments: can("payment:confirm"),
    };
  });
  const format = await getFormatter();
  const money = (minor: number) => formatMoney(minor, view.bill.currency, locale);
  const t = await getTranslations("Bill");
  const { bill, lines, tableNumber, awaitingKitchen } = view;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/dashboard/r/${restaurantId}/tables`}
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("backToTables")}
      </Link>
      <h2 className="text-xl font-semibold">{t("tableTitle", { number: tableNumber })}</h2>
      {bill.status === "open" && awaitingKitchen > 0 && (
        <p role="status" className="rounded-lg bg-muted/50 p-3 text-sm">
          {t("awaitingKitchen", { count: awaitingKitchen })}
        </p>
      )}
      <BillDetails
        bill={bill}
        lines={lines}
        locale={locale}
        coveredItemIds={state?.coveredItemIds}
      />
      {state && state.payments.length > 0 && (
        <section aria-labelledby="payments-heading" className="flex flex-col gap-2">
          <h3 id="payments-heading" className="font-semibold">
            {t("paymentsTitle")}
          </h3>
          <ul className="flex flex-col divide-y rounded-2xl border text-sm">
            {state.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span>
                  {p.mode === "equal"
                    ? t("paymentShare", { index: p.shareIndex!, count: p.shareCount! })
                    : t(`paymentMode.${p.mode}`)}{" "}
                  · {t(`paymentMethod.${p.method}`)} ·{" "}
                  {format.dateTime(p.createdAt, { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="tabular-nums">
                  {money(p.amountMinor)} · {t(`paymentStatus.${p.status}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {bill.status === "finalized" && canTakePayments && state && state.remainingMinor > 0 && (
        <RecordPaymentPanel
          restaurantId={restaurantId}
          billId={bill.id}
          remaining={money(state.remainingMinor)}
          shareCount={state.split?.count ?? null}
          picker={
            state.split
              ? null
              : {
                  lines: lines.filter((l) => !state.coveredItemIds.includes(l.id)),
                  people: view.members.map((m) => ({
                    memberId: m.id,
                    label: m.name ?? t("guestN", { n: m.position }),
                  })),
                  bill: {
                    subtotalMinor: bill.subtotalMinor,
                    totalMinor: bill.totalMinor,
                    heldMinor: state.heldMinor,
                    currency: bill.currency,
                  },
                  initial: [],
                }
          }
          freeShares={
            state.split
              ? Array.from({ length: state.split.count }, (_, i) => i + 1)
                  .filter((index) => !state.split!.taken.includes(index))
                  .map((index) => ({
                    index,
                    amount: money(
                      equalShare(bill.totalMinor, state.split!.count, index, bill.currency),
                    ),
                  }))
              : []
          }
        />
      )}
      <BillActions
        restaurantId={restaurantId}
        sessionId={sessionId}
        billId={bill.id}
        tableNumber={tableNumber}
        canFinalize={
          canManage && bill.status === "open" && lines.length > 0 && awaitingKitchen === 0
        }
        canVoid={
          canManage &&
          (bill.status === "open" || bill.status === "finalized") &&
          (state?.heldMinor ?? 0) === 0
        }
      />
      <LiveRefresh
        channel={realtimeChannels.location(restaurantId, bill.locationId)}
        enabled={isRealtimeEnabled()}
        fallbackSeconds={15}
      />
    </div>
  );
}
