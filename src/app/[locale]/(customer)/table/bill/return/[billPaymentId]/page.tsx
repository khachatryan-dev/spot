import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveLocale } from "@/i18n/locale";
import { getPathname } from "@/i18n/navigation";
import { findGuestBillPayment } from "@/server/services/bill-payment-service";
import { syncPayment } from "@/server/services/payment-service";

export const metadata: Metadata = { robots: { index: false } };

/**
 * Back from the payment page: ask the provider (never trust the browser,
 * §21), then show the bill.
 */
export default async function BillPaymentReturnPage({
  params,
}: PageProps<"/[locale]/table/bill/return/[billPaymentId]">) {
  const locale = await resolveLocale(params);
  const { billPaymentId } = await params;
  const billPayment = await findGuestBillPayment(billPaymentId);
  if (billPayment?.paymentId) await syncPayment(billPayment.paymentId, { source: "return" });
  redirect(getPathname({ href: "/table/bill", locale }));
}
