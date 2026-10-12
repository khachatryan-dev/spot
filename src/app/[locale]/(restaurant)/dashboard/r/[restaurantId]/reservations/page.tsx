import { ChevronLeft, ChevronRight, CreditCard, Phone, Users } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LiveRefresh } from "@/features/ordering/live-refresh";
import { BookingLink } from "@/features/reservations/booking-link";
import { ReservationActions } from "@/features/reservations/reservation-actions";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { guardPage, requireUser } from "@/server/auth/guards";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { realtimeChannels } from "@/server/realtime/channels";
import { isRealtimeEnabled } from "@/server/realtime/realtime";
import { listLocations } from "@/server/services/location-service";
import { listReservationsForStaff } from "@/server/services/reservation-service";
import { getRestaurant } from "@/server/services/restaurant-service";
import { type RestaurantPermission, roleHasPermission } from "@/shared/auth/permissions";
import { ACTIVE_RESERVATION_STATUSES } from "@/shared/constants/reservations";
import { addDays, localDate } from "@/shared/domain/reservation-slots";
import { availableActions } from "@/shared/domain/reservation-status";
import { calendarDateSchema } from "@/shared/schemas/reservation";
import { bookingUrl } from "@/shared/utils/booking-url";
import { formatMoney } from "@/shared/utils/money";
import type { PaymentStatus } from "@/shared/constants/payments";

const isActive = (status: string) =>
  (ACTIVE_RESERVATION_STATUSES as readonly string[]).includes(status);

/** A location's reservations for one day (§19), refreshed live when bookings arrive. */
export default async function ReservationsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/reservations">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const { location: requestedLocation, date: requestedDate } = await searchParams;
  const data = await guardPage(locale, async () => {
    const user = await requireUser();
    const access = await authorizeRestaurant(user.id, restaurantId, "reservation:read");
    const restaurant = await getRestaurant(user, restaurantId);
    const locations = (await listLocations(user, restaurantId)).filter(
      (l) => l.status === "active",
    );
    const location = locations.find((l) => l.id === requestedLocation) ?? locations[0];
    if (!location) return { restaurant, locations, location: null };
    const can = (p: RestaurantPermission) => roleHasPermission(access.role, p);
    const today = localDate(new Date(), location.timezone);
    const parsed = calendarDateSchema.safeParse(requestedDate);
    const date = parsed.success ? parsed.data : today;
    const { reservations, currency } = await listReservationsForStaff(
      user,
      restaurantId,
      location.id,
      date,
    );
    const now = new Date();
    const withActions = reservations.map((r) => ({ ...r, actions: availableActions(r, can, now) }));
    return { restaurant, locations, location, today, date, currency, reservations: withActions };
  });
  const t = await getTranslations("StaffReservations");
  const status = await getTranslations("Reservations.status");
  const depositState = await getTranslations("Reservations.depositState");
  const depositLabel = (s: PaymentStatus | null) =>
    depositState(
      s === "refunded"
        ? "refunded"
        : s === "partially_refunded"
          ? "partiallyRefunded"
          : s === "succeeded"
            ? "paid"
            : "unpaid",
    );
  const format = await getFormatter();

  if (!data.location) return <p className="text-sm text-muted-foreground">{t("noLocation")}</p>;
  const { location, date, today, reservations } = data;
  const base = `/dashboard/r/${restaurantId}/reservations`;
  const dayHref = (day: string) => ({
    pathname: base,
    query: { location: location.id, date: day },
  });
  const time = (at: Date) =>
    format.dateTime(at, { hour: "2-digit", minute: "2-digit", timeZone: location.timezone });
  const active = reservations.filter((r) => isActive(r.status));
  const guests = active.reduce((sum, r) => sum + r.partySize, 0);
  const pending = reservations.filter((r) => r.status === "pending_confirmation").length;

  return (
    <div className="flex flex-col gap-6">
      {data.locations.length > 1 && (
        <nav aria-label={t("locationPicker")} className="flex flex-wrap gap-2">
          {data.locations.map((l) => (
            <Link
              key={l.id}
              href={{ pathname: base, query: { location: l.id, date } }}
              aria-current={l.id === location.id ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                l.id === location.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {l.name}
            </Link>
          ))}
        </nav>
      )}

      {!location.reservationsEnabled ? (
        <p className="rounded-xl bg-muted/50 p-4 text-sm">
          {t("disabled")}{" "}
          <Link
            href={`/dashboard/r/${restaurantId}/locations/${location.id}`}
            className="font-medium underline underline-offset-4"
          >
            {t("openSettings")}
          </Link>
        </p>
      ) : data.restaurant.status === "active" ? (
        <BookingLink url={bookingUrl(data.restaurant.slug, location.slug)} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("linkAfterApproval")}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={t("previousDay")}
          render={<Link href={dayHref(addDays(date, -1))} />}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <form className="flex items-center gap-2" aria-label={t("pickDate")}>
          <input type="hidden" name="location" value={location.id} />
          <label htmlFor="day" className="sr-only">
            {t("date")}
          </label>
          <Input id="day" name="date" type="date" defaultValue={date} className="w-auto" />
          <Button type="submit" variant="secondary">
            {t("show")}
          </Button>
        </form>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("nextDay")}
          render={<Link href={dayHref(addDays(date, 1))} />}
        >
          <ChevronRight aria-hidden />
        </Button>
        {date !== today && (
          <Button variant="ghost" render={<Link href={dayHref(today)} />}>
            {t("today")}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          {format.dateTime(new Date(`${date}T12:00:00Z`), {
            weekday: "long",
            day: "numeric",
            month: "long",
            timeZone: "UTC",
          })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("summary", { bookings: active.length, guests })}
          {pending > 0 && <> · {t("pendingCount", { count: pending })}</>}
        </p>
      </div>

      {reservations.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t("listLabel")}>
          {reservations.map((r) => (
            <li
              key={r.id}
              className={cn(
                "flex flex-col gap-2 rounded-2xl border p-4",
                !isActive(r.status) && "opacity-60",
                r.status === "pending_confirmation" && "border-primary",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold tabular-nums">
                  {time(r.startsAt)}–{time(r.endsAt)} · {t("table", { table: r.tableNumber })}
                </span>
                <Badge variant={isActive(r.status) ? "default" : "outline"}>
                  {status(r.status)}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium">{r.contactName}</span>
                <span className="flex items-center gap-1">
                  <Users className="size-4" aria-hidden />
                  {t("guests", { count: r.partySize })}
                </span>
                <a
                  href={`tel:${r.contactPhone}`}
                  className="flex items-center gap-1 underline-offset-4 hover:underline"
                >
                  <Phone className="size-4" aria-hidden />
                  {r.contactPhone}
                </a>
              </div>
              {r.depositMinor > 0 && (
                <span className="flex items-center gap-1 text-sm">
                  <CreditCard className="size-4" aria-hidden />
                  {t("deposit", {
                    amount: formatMoney(r.depositMinor, data.currency, locale),
                    state: depositLabel(r.deposit?.status ?? null),
                  })}
                </span>
              )}
              {r.note && <p className="text-sm text-muted-foreground">“{r.note}”</p>}
              <ReservationActions
                restaurantId={restaurantId}
                reservationId={r.id}
                guest={r.contactName}
                actions={r.actions}
              />
            </li>
          ))}
        </ul>
      )}

      <LiveRefresh
        channel={realtimeChannels.location(restaurantId, location.id)}
        enabled={isRealtimeEnabled()}
        fallbackSeconds={15}
      />
    </div>
  );
}
