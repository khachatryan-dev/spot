import {
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  MapPin,
  Plus,
  Star,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/shared/empty-state";
import { CancelReservationButton } from "@/features/reservations/cancel-reservation-button";
import { PayDepositButton } from "@/features/reservations/pay-deposit-button";
import { ReservationStatusBadge } from "@/features/reservations/reservation-status-badge";
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

  const upcoming = reservations.filter((r) => r.endsAt > now && isActive(r.status));
  const past = reservations.filter((r) => !upcoming.includes(r));

  const item = (r: MyReservation) => (
    <li
      key={r.id}
      className="flex flex-col gap-3 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border aria-[current=true]:ring-2 aria-[current=true]:ring-primary"
      aria-current={r.id === created ? "true" : undefined}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
        >
          <span className="text-xs font-medium uppercase">
            {format.dateTime(r.startsAt, { month: "short", timeZone: r.timezone })}
          </span>
          <span className="text-xl leading-none font-bold">
            {format.dateTime(r.startsAt, { day: "numeric", timeZone: r.timezone })}
          </span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">{r.restaurantName}</span>
            <ReservationStatusBadge status={r.status} />
          </div>
          <span className="flex items-center gap-1.5 text-sm">
            <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {format.dateTime(r.startsAt, {
              weekday: "short",
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: r.timezone,
            })}
          </span>
          <span className="flex items-center gap-1.5 text-sm">
            <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t("guests", { count: r.partySize })}</span>
          </span>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-4 shrink-0" aria-hidden />
            {r.locationName} · {r.addressLine}, {r.city}
          </span>
        </div>
      </div>
      {r.cancellationReason && r.status === "cancelled" && (
        <p className="rounded-xl bg-destructive/10 p-2 text-xs text-destructive">
          {t("reason", { reason: r.cancellationReason })}
        </p>
      )}
      {r.depositMinor > 0 && (
        <span className="flex items-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm">
          <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
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
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("myTitle")}</h1>
        <Link
          href="/restaurants"
          className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm"
        >
          <Plus className="size-4" aria-hidden />
          {t("bookNew")}
        </Link>
      </div>

      {justMade && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-3 text-sm font-medium text-emerald-900 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50"
        >
          <CheckCircle2
            className="size-5 shrink-0 text-emerald-700 dark:text-emerald-300"
            aria-hidden
          />
          {t(
            justMade.status === "confirmed"
              ? "createdConfirmed"
              : justMade.status === "pending_payment"
                ? "createdAwaitingPayment"
                : "createdPending",
          )}
        </p>
      )}

      {toRate > 0 && (
        <Link
          href="/reviews"
          className="flex items-center gap-3 rounded-3xl bg-amber-50 p-4 text-sm font-medium ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-800"
        >
          <Star className="size-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
          {t("rateVisits", { count: toRate })}
        </Link>
      )}

      {reservations.length === 0 ? (
        <EmptyState icon={CalendarDays}>{t("myEmpty")}</EmptyState>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section aria-labelledby="upcoming-heading" className="flex flex-col gap-3">
              <h2 id="upcoming-heading" className="px-1 font-semibold">
                {t("upcomingTitle")}
              </h2>
              <ul className="flex flex-col gap-3" aria-label={t("myTitle")}>
                {upcoming.map(item)}
              </ul>
            </section>
          )}
          {past.length > 0 && (
            <section aria-labelledby="past-heading" className="flex flex-col gap-3">
              <h2 id="past-heading" className="px-1 font-semibold text-muted-foreground">
                {t("pastTitle")}
              </h2>
              <ul className="flex flex-col gap-3" aria-label={t("pastTitle")}>
                {past.map(item)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
