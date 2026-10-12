import { CalendarDays, MapPin } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FavoriteButton } from "@/features/account/favorite-button";
import { BookingPanel } from "@/features/reservations/booking-panel";
import { ReviewSummary } from "@/features/reviews/review-summary";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { localizePath } from "@/i18n/paths";
import { trackPageEvent } from "@/server/analytics/track";
import { getSession } from "@/server/auth/session";
import { isFavorite } from "@/server/services/account-service";
import { getReviewSummary } from "@/server/services/review-service";
import {
  findBookingLocation,
  getReservationAvailability,
} from "@/server/services/reservation-availability-service";
import { depositFor } from "@/shared/domain/reservation-deposit";
import { addDays, localDate } from "@/shared/domain/reservation-slots";
import { availabilityQuerySchema } from "@/shared/schemas/reservation";
import { formatMoney } from "@/shared/utils/money";

/** Party sizes offered in the picker; bigger groups call the restaurant. */
const PARTY_SIZES = Array.from({ length: 20 }, (_, i) => i + 1);

type Props = PageProps<"/[locale]/r/[restaurantSlug]/[locationSlug]/reserve">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { restaurantSlug, locationSlug } = await params;
  const location = await findBookingLocation(restaurantSlug, locationSlug);
  const t = await getTranslations("Reservations");
  return {
    title: location ? t("pageTitle", { name: location.restaurantName }) : undefined,
    robots: { index: false },
  };
}

/** Public booking page for one location (§19, §20): pick date, party, time. */
export default async function ReservePage({ params, searchParams }: Props) {
  const locale = await resolveLocale(params);
  const { restaurantSlug, locationSlug } = await params;
  const location = await findBookingLocation(restaurantSlug, locationSlug);
  if (!location) notFound();

  const t = await getTranslations("Reservations");
  const format = await getFormatter();
  const today = localDate(new Date(), location.timezone);
  const lastDay = addDays(today, location.maxDaysAhead);
  const query = await searchParams;
  const parsed = availabilityQuerySchema.safeParse({
    date: query.date ?? today,
    partySize: query.party ?? 2,
  });
  const date =
    parsed.success && parsed.data.date >= today && parsed.data.date <= lastDay
      ? parsed.data.date
      : today;
  const partySize = parsed.success ? parsed.data.partySize : 2;

  const session = await getSession();
  await trackPageEvent("booking_page_viewed", {
    restaurantId: location.restaurantId,
    locationId: location.locationId,
  });
  const availability = location.reservationsEnabled
    ? await getReservationAvailability(location.restaurantId, location.locationId, {
        date,
        partySize,
      })
    : null;
  const depositMinor = depositFor(location, partySize);
  const selfPath = `/r/${restaurantSlug}/${locationSlug}/reserve?date=${date}&party=${partySize}`;

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-2xl font-semibold">
            <Link href={`/r/${restaurantSlug}`} className="underline-offset-4 hover:underline">
              {location.restaurantName}
            </Link>
          </h1>
          <FavoriteButton
            restaurantId={location.restaurantId}
            restaurantName={location.restaurantName}
            saved={session ? await isFavorite(session.user, location.restaurantId) : false}
            loginHref={
              session ? null : `/login?next=${encodeURIComponent(localizePath(selfPath, locale))}`
            }
          />
        </div>
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="size-4 shrink-0" aria-hidden />
          {location.locationName} · {location.addressLine}, {location.city}
        </p>
      </header>

      <ReviewSummary {...await getReviewSummary(location.restaurantId)} />

      {!availability?.available ? (
        <p className="rounded-xl bg-muted/50 p-4 text-sm">{t("disabled")}</p>
      ) : (
        <>
          <form className="flex flex-wrap items-end gap-3" aria-label={t("searchTitle")}>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="date">{t("fields.date")}</Label>
              <Input
                id="date"
                name="date"
                type="date"
                min={today}
                max={lastDay}
                defaultValue={date}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="party">{t("fields.party")}</Label>
              <select
                id="party"
                name="party"
                defaultValue={partySize}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              >
                {PARTY_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {t("guests", { count: n })}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="secondary">
              {t("showTimes")}
            </Button>
          </form>

          <p className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="size-4" aria-hidden />
            {format.dateTime(new Date(`${date}T12:00:00Z`), {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            })}{" "}
            · {t("guests", { count: partySize })}
          </p>

          <BookingPanel
            key={`${date}-${partySize}`}
            restaurantId={location.restaurantId}
            locationId={location.locationId}
            partySize={partySize}
            slots={availability.slots.map((s) => ({
              startsAt: s.startsAt.toISOString(),
              time: s.time,
            }))}
            loginHref={
              session ? null : `/login?next=${encodeURIComponent(localizePath(selfPath, locale))}`
            }
            defaults={{
              contactName: session?.user.name ?? "",
              contactPhone: session?.user.phone ?? "",
            }}
            deposit={
              depositMinor > 0
                ? {
                    amount: formatMoney(depositMinor, location.currency, locale),
                    refundCutoffHours: location.refundCutoffHours,
                  }
                : null
            }
          />
          <p className="text-xs text-muted-foreground">
            {t(location.confirmation === "auto" ? "autoNote" : "manualNote", {
              minutes: availability.durationMinutes,
            })}
          </p>
        </>
      )}

      {session && (
        <Link
          href="/reservations"
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          {t("myReservations")}
        </Link>
      )}
    </div>
  );
}
