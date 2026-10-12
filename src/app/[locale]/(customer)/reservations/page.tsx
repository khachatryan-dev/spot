import { CalendarCheck, CheckCircle2, CreditCard, MapPin, Users } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { CancelReservationButton } from "@/features/reservations/cancel-reservation-button";
import { PayDepositButton } from "@/features/reservations/pay-deposit-button";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requireUser } from "@/server/auth/guards";
import { listReviewOpportunities } from "@/server/services/review-service";
import { listMyReservations, type MyReservation } from "@/server/services/reservation-service";
import { ACTIVE_RESERVATION_STATUSES } from "@/shared/constants/reservations";
import { isPaid } from "@/shared/domain/payment-status";
import { isRefundableCancellation } from "@/shared/domain/reservation-deposit";
import { canCustomerCancel } from "@/shared/domain/reservation-status";
import { formatMoney } from "@/shared/utils/money";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Reservations");
  return { title: t("myTitle"), robots: { index: false } };
}

/** One word for where a booking's deposit stands. */
function depositStateKey(r: MyReservation) {
  if (!r.deposit) return r.status === "pending_payment" ? "unpaid" : "none";
  if (r.deposit.status === "refunded") return "refunded";
  if (r.deposit.status === "partially_refunded") return "partiallyRefunded";
  if (isPaid(r.deposit.status)) return "paid";
  return r.status === "pending_payment" ? "unpaid" : "none";
}

const isActive = (status: string) =>
  (ACTIVE_RESERVATION_STATUSES as readonly string[]).includes(status);

/** The signed-in guest's reservations: upcoming first, then past (§25). */
export default async function MyReservationsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/reservations">) {
  const locale = await resolveLocale(params);
  const user = await guardPage(locale, requireUser);
  const { created } = await searchParams;
  const now = new Date();
  const reservations = await listMyReservations(user, now);
  const toRate = (await listReviewOpportunities({ type: "user", user })).length;
  const t = await getTranslations("Reservations");
  const format = await getFormatter();
  const justMade = reservations.find((r) => r.id === created);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("myTitle")}</h1>
        <Link href="/account" className="text-sm font-medium underline-offset-4 hover:underline">
          {t("account")}
        </Link>
      </div>
      {toRate > 0 && (
        <Link
          href="/reviews"
          className="self-start rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          {t("rateVisits", { count: toRate })}
        </Link>
      )}

      {justMade && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-sm font-medium"
        >
          <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden />
          {t(
            justMade.status === "confirmed"
              ? "createdConfirmed"
              : justMade.status === "pending_payment"
                ? "createdAwaitingPayment"
                : "createdPending",
          )}
        </p>
      )}

      {reservations.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("myEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t("myTitle")}>
          {reservations.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 rounded-2xl border p-4"
              aria-current={r.id === created ? "true" : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{r.restaurantName}</span>
                <Badge variant={isActive(r.status) ? "default" : "outline"}>
                  {t(`status.${r.status}`)}
                </Badge>
              </div>
              <span className="flex items-center gap-2 text-sm">
                <CalendarCheck className="size-4 shrink-0" aria-hidden />
                {format.dateTime(r.startsAt, {
                  weekday: "short",
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: r.timezone,
                })}
              </span>
              <span className="flex items-center gap-2 text-sm">
                <Users className="size-4 shrink-0" aria-hidden />
                {t("guests", { count: r.partySize })}
              </span>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="size-4 shrink-0" aria-hidden />
                {r.locationName} · {r.addressLine}, {r.city}
              </span>
              {r.cancellationReason && r.status === "cancelled" && (
                <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  {t("reason", { reason: r.cancellationReason })}
                </p>
              )}
              {r.depositMinor > 0 && (
                <span className="flex items-center gap-2 text-sm">
                  <CreditCard className="size-4 shrink-0" aria-hidden />
                  {t("depositLine", {
                    amount: formatMoney(r.depositMinor, r.currency, locale),
                    state: t(`depositState.${depositStateKey(r)}`),
                  })}
                </span>
              )}
              {r.status === "pending_payment" && (
                <PayDepositButton
                  reservationId={r.id}
                  amount={formatMoney(r.depositMinor, r.currency, locale)}
                />
              )}
              {canCustomerCancel(r, now) && (
                <CancelReservationButton
                  reservationId={r.id}
                  restaurant={r.restaurantName}
                  depositNote={
                    r.deposit && isPaid(r.deposit.status)
                      ? t(
                          isRefundableCancellation(r.startsAt, r.refundCutoffHours, now)
                            ? "cancelRefunded"
                            : "cancelNotRefunded",
                          { hours: r.refundCutoffHours },
                        )
                      : undefined
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
