"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Clock, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { useApiError } from "@/components/shared/use-api-error";
import { useFieldError } from "@/components/shared/use-field-error";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { reservationContactSchema } from "@/shared/schemas/reservation";

import { createReservationAction, holdTimeAction, releaseHoldAction } from "./actions";

type ContactInput = z.input<typeof reservationContactSchema>;
type Contact = z.output<typeof reservationContactSchema>;

interface Props {
  restaurantId: string;
  locationId: string;
  partySize: number;
  slots: { startsAt: string; time: string }[];
  /** Where to sign in and come back; null when signed in. */
  loginHref: string | null;
  defaults: { contactName: string; contactPhone: string };
  /** Deposit for this party, already formatted ("6 000 ֏"); null = none. */
  deposit: { amount: string; refundCutoffHours: number } | null;
}

/** Free times as buttons; picking one holds a table, then asks for contact details. */
export function BookingPanel({
  restaurantId,
  locationId,
  partySize,
  slots,
  loginHref,
  defaults,
  deposit,
}: Props) {
  const t = useTranslations("Reservations");
  const apiError = useApiError();
  const router = useRouter();
  const [picking, setPicking] = useState<string | null>(null);
  const [hold, setHold] = useState<{ id: string; time: string; expiresAt: number } | null>(null);

  async function pick(slot: Props["slots"][number]) {
    setPicking(slot.startsAt);
    const result = await holdTimeAction({
      restaurantId,
      locationId,
      startsAt: slot.startsAt,
      partySize,
    });
    setPicking(null);
    if (result.error) {
      toast.error(apiError.message(result.error));
      router.refresh(); // the time may be gone: show what's still free
      return;
    }
    setHold({ id: result.data.id, time: slot.time, expiresAt: Date.parse(result.data.expiresAt) });
  }

  async function changeTime() {
    if (hold) await releaseHoldAction(hold.id);
    setHold(null);
    router.refresh();
  }

  if (slots.length === 0) {
    return <p className="rounded-xl bg-muted/50 p-4 text-sm">{t("noTimes")}</p>;
  }

  if (hold) {
    return (
      <ContactStep
        hold={hold}
        defaults={defaults}
        deposit={deposit}
        onExpired={() => {
          setHold(null);
          toast.error(t("holdExpired"));
          router.refresh();
        }}
        onChangeTime={changeTime}
      />
    );
  }

  return (
    <section aria-labelledby="times-heading" className="flex flex-col gap-3">
      <h2 id="times-heading" className="font-semibold">
        {t("timesTitle")}
      </h2>
      {loginHref && <p className="text-sm text-muted-foreground">{t("signInToBook")}</p>}
      <ul className="grid grid-cols-4 gap-2" aria-label={t("timesTitle")}>
        {slots.map((slot) => (
          <li key={slot.startsAt}>
            {loginHref ? (
              <Button
                variant="outline"
                className="w-full tabular-nums"
                render={<Link href={loginHref} />}
              >
                {slot.time}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="w-full tabular-nums"
                disabled={picking !== null}
                aria-label={t("pickTime", { time: slot.time })}
                onClick={() => pick(slot)}
              >
                {picking === slot.startsAt ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  slot.time
                )}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function useSecondsLeft(until: number) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((until - Date.now()) / 1000)));
  useEffect(() => {
    const id = setInterval(
      () => setLeft(Math.max(0, Math.round((until - Date.now()) / 1000))),
      1000,
    );
    return () => clearInterval(id);
  }, [until]);
  return left;
}

function ContactStep({
  hold,
  defaults,
  deposit,
  onExpired,
  onChangeTime,
}: {
  hold: { id: string; time: string; expiresAt: number };
  defaults: Props["defaults"];
  deposit: Props["deposit"];
  onExpired: () => void;
  onChangeTime: () => void;
}) {
  const t = useTranslations("Reservations");
  const fieldError = useFieldError();
  const apiError = useApiError();
  const router = useRouter();
  const secondsLeft = useSecondsLeft(hold.expiresAt);
  const form = useForm<ContactInput, unknown, Contact>({
    resolver: zodResolver(reservationContactSchema),
    defaultValues: { ...defaults, note: "" },
  });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (secondsLeft === 0) onExpired();
  }, [secondsLeft, onExpired]);

  async function onSubmit(values: Contact) {
    const result = await createReservationAction({ holdId: hold.id, ...values });
    if (result.error) {
      apiError.applyFieldErrors(result.error, form.setError);
      toast.error(apiError.message(result.error));
      return;
    }
    if (result.data.payUrl) {
      // The provider's payment page; it sends the guest back to /reservations/pay/<id>.
      window.location.assign(result.data.payUrl);
      return;
    }
    router.push({ pathname: "/reservations", query: { created: result.data.id } });
  }

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  return (
    <section aria-labelledby="contact-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/10 p-3">
        <h2 id="contact-heading" className="font-semibold">
          {t("heldTitle", { time: hold.time })}
        </h2>
        <span className="flex items-center gap-1 text-sm tabular-nums" role="timer">
          <Clock className="size-4" aria-hidden />
          <span className="sr-only">{t("holdLeft")}</span>
          {minutes}:{seconds}
        </span>
      </div>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <Field data-invalid={!!errors.contactName}>
            <FieldLabel htmlFor="contactName">{t("fields.name")}</FieldLabel>
            <Input
              id="contactName"
              autoComplete="name"
              aria-invalid={!!errors.contactName}
              {...form.register("contactName")}
            />
            <FieldError>{fieldError(errors.contactName?.message)}</FieldError>
          </Field>
          <Field data-invalid={!!errors.contactPhone}>
            <FieldLabel htmlFor="contactPhone">{t("fields.phone")}</FieldLabel>
            <Input
              id="contactPhone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+374 91 000000"
              aria-invalid={!!errors.contactPhone}
              {...form.register("contactPhone")}
            />
            <FieldError>{fieldError(errors.contactPhone?.message)}</FieldError>
          </Field>
          <Field data-invalid={!!errors.note}>
            <FieldLabel htmlFor="note">{t("fields.note")}</FieldLabel>
            <Textarea
              id="note"
              rows={2}
              placeholder={t("fields.notePlaceholder")}
              aria-invalid={!!errors.note}
              {...form.register("note")}
            />
            <FieldError>{fieldError(errors.note?.message)}</FieldError>
          </Field>
          {deposit && (
            <p className="rounded-lg bg-muted/50 p-3 text-sm">
              {t("depositNote", { amount: deposit.amount, hours: deposit.refundCutoffHours })}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            {deposit ? t("submitAndPay", { amount: deposit.amount }) : t("submit")}
          </Button>
          <Button type="button" variant="ghost" onClick={onChangeTime} disabled={isSubmitting}>
            {t("changeTime")}
          </Button>
        </FieldGroup>
      </form>
    </section>
  );
}
