import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveLocale } from "@/i18n/locale";
import { getPathname } from "@/i18n/navigation";
import { guardPage, requireUser } from "@/server/auth/guards";
import { refreshDepositOnReturn } from "@/server/services/reservation-deposit-service";

export const metadata: Metadata = { robots: { index: false } };

/**
 * Where the payment provider sends the guest back. The browser's word
 * counts for nothing (§21): we ask the provider, then show the booking.
 */
export default async function DepositReturnPage({
  params,
}: PageProps<"/[locale]/reservations/pay/[reservationId]">) {
  const locale = await resolveLocale(params);
  const { reservationId } = await params;
  const user = await guardPage(locale, requireUser);
  await refreshDepositOnReturn(user, reservationId);
  redirect(
    getPathname({ href: { pathname: "/reservations", query: { created: reservationId } }, locale }),
  );
}
