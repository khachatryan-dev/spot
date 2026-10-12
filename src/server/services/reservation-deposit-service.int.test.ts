import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { auditLogs, payments, reservationHolds, reservations } from "@/server/db/schema";
import { createFakeProvider, type FakeProvider } from "@/server/payments/fake-provider";
import { setPaymentProviderForTests } from "@/server/payments/registry";
import { truncate } from "@/test/db";
import {
  guest,
  local,
  MINUTE,
  NOW,
  reservationSetup,
  staffMember,
} from "@/test/reservation-fixtures";

import { handlePaymentWebhook, startPayment, syncPayment } from "./payment-service";
import { startDepositPayment } from "./reservation-deposit-service";
import { expireOverdueReservations, placeReservationHold } from "./reservation-hold-service";
import {
  cancelMyReservation,
  createReservation,
  updateReservationStatus,
} from "./reservation-service";

let bank: FakeProvider;
afterAll(() => setPaymentProviderForTests(undefined));
beforeEach(async () => {
  await truncate(db, [
    "payment_refunds",
    "payment_events",
    "payments",
    "restaurants",
    "users",
    "rate_limits",
    "audit_logs",
  ]);
  bank = createFakeProvider();
  setPaymentProviderForTests(bank);
});

const contact = { contactName: "Anna", contactPhone: "+37491000000" };
const reservationOf = async (id: string) =>
  (await db.select().from(reservations).where(eq(reservations.id, id)))[0]!;
const holdOf = async (id: string) =>
  (await db.select().from(reservationHolds).where(eq(reservationHolds.reservationId, id)))[0]!;
const latestPayment = async (reservationId: string) =>
  (await db.select().from(payments).where(eq(payments.reservationId, reservationId))).at(-1)!;

/** 2 000 ֏ per guest; a party of 3 books Friday 19:00. */
async function booked(overrides = {}) {
  const s = await reservationSetup([4], {
    reservationDepositType: "per_guest",
    reservationDepositMinor: 200_000,
    ...overrides,
  });
  const anna = await guest("anna@x.am");
  const hold = await placeReservationHold(anna, s.holdInput("19:00", 3), NOW);
  const reservation = await createReservation(anna, { holdId: hold.id, ...contact }, NOW);
  /** Guest pays (or the bank declines) and comes back to the return page. */
  const pay = async (outcome: "complete" | "fail" = "complete") => {
    await startDepositPayment(anna, reservation.id);
    const payment = await latestPayment(reservation.id);
    bank[outcome](payment.providerPaymentId!);
    await syncPayment(payment.id, { source: "return" });
    return payment;
  };
  return { ...s, anna, reservation, pay };
}

describe("reservation deposits", () => {
  it("waits for the deposit, holding the table for the payment window", async () => {
    const { reservation, anna } = await booked();
    expect(reservation).toMatchObject({ status: "pending_payment", depositMinor: 600_000 });
    expect((await holdOf(reservation.id)).expiresAt).toEqual(new Date(NOW.getTime() + 15 * MINUTE));
    const { redirectUrl } = await startDepositPayment(anna, reservation.id);
    expect(redirectUrl).toContain("pay.fake.test");
    expect(await latestPayment(reservation.id)).toMatchObject({
      purpose: "reservation_deposit",
      amountMinor: 600_000,
      currency: "AMD",
      status: "pending",
    });
  });

  it("confirms the booking once the provider confirms the payment (auto mode)", async () => {
    const { reservation, pay } = await booked({ reservationConfirmation: "auto" });
    await pay();
    expect(await reservationOf(reservation.id)).toMatchObject({ status: "confirmed" });
    expect((await holdOf(reservation.id)).expiresAt).toBeNull();
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "reservation.deposit_paid"));
    expect(audit).toMatchObject({ actorUserId: null, entityId: reservation.id });
  });

  it("passes a paid request on to staff in manual mode", async () => {
    const { reservation, pay } = await booked();
    await pay();
    expect(await reservationOf(reservation.id)).toMatchObject({ status: "pending_confirmation" });
    expect((await holdOf(reservation.id)).expiresAt).toEqual(local("19:00"));
  });

  it("also settles through the provider's webhook", async () => {
    const { reservation, anna } = await booked({ reservationConfirmation: "auto" });
    await startDepositPayment(anna, reservation.id);
    const payment = await latestPayment(reservation.id);
    bank.complete(payment.providerPaymentId!);
    await handlePaymentWebhook(
      "fake",
      bank.webhookRequest({
        eventId: "evt_dep",
        providerPaymentId: payment.providerPaymentId!,
        type: "payment.succeeded",
      }),
    );
    expect((await reservationOf(reservation.id)).status).toBe("confirmed");
  });

  it("lets the guest try again after a declined card", async () => {
    const { reservation, pay } = await booked({ reservationConfirmation: "auto" });
    const first = await pay("fail");
    expect((await reservationOf(reservation.id)).status).toBe("pending_payment");
    const second = await pay();
    expect(second.id).not.toBe(first.id);
    expect((await reservationOf(reservation.id)).status).toBe("confirmed");
  });

  it("refunds a deposit that arrives after the payment window closed", async () => {
    const { reservation, anna } = await booked();
    await startDepositPayment(anna, reservation.id);
    const payment = await latestPayment(reservation.id);
    await expireOverdueReservations(undefined, new Date(NOW.getTime() + 16 * MINUTE));
    expect((await reservationOf(reservation.id)).status).toBe("expired");

    bank.complete(payment.providerPaymentId!);
    await syncPayment(payment.id, { source: "webhook" });
    expect(await latestPayment(reservation.id)).toMatchObject({
      status: "refunded",
      refundedMinor: 600_000,
    });
    expect((await reservationOf(reservation.id)).status).toBe("expired");
  });

  it("refunds a guest who cancels before the cutoff, not after", async () => {
    const early = await booked({ reservationConfirmation: "auto" });
    await early.pay();
    // Thursday 10:00 is 33 hours before Friday 19:00 (cutoff 24 h).
    await cancelMyReservation(early.anna, early.reservation.id, NOW);
    expect((await latestPayment(early.reservation.id)).status).toBe("refunded");

    await truncate(db, ["payment_refunds", "payment_events", "payments", "restaurants", "users"]);
    const late = await booked({ reservationConfirmation: "auto" });
    await late.pay();
    await cancelMyReservation(late.anna, late.reservation.id, local("20:00", "2030-01-17"));
    expect((await latestPayment(late.reservation.id)).status).toBe("succeeded");
  });

  it("always refunds when the restaurant declines or cancels; keeps it for no-shows", async () => {
    const declined = await booked();
    await declined.pay();
    const manager = await staffMember(declined.restaurant.id, "m@x.am", "manager");
    await updateReservationStatus(
      manager,
      declined.restaurant.id,
      declined.reservation.id,
      "decline",
      { reason: "Private event" },
      local("18:00"),
    );
    expect((await latestPayment(declined.reservation.id)).status).toBe("refunded");

    await truncate(db, ["payment_refunds", "payment_events", "payments", "restaurants", "users"]);
    const noShow = await booked({ reservationConfirmation: "auto" });
    await noShow.pay();
    const owner = await staffMember(noShow.restaurant.id, "o@x.am", "owner");
    await updateReservationStatus(
      owner,
      noShow.restaurant.id,
      noShow.reservation.id,
      "no_show",
      {},
      local("19:30"),
    );
    expect((await latestPayment(noShow.reservation.id)).status).toBe("succeeded");
  });

  it("refunds a second deposit payment for an already confirmed booking", async () => {
    const { reservation, pay, restaurant, anna } = await booked({
      reservationConfirmation: "auto",
    });
    const first = await pay();
    // A stray second payment for the same booking (e.g. paid from another device).
    const { payment: extra } = await startPayment({
      restaurantId: restaurant.id,
      purpose: "reservation_deposit",
      reservationId: reservation.id,
      customerUserId: anna.id,
      amountMinor: 600_000,
      currency: "AMD",
      description: "Deposit",
      returnUrl: "https://spot.test/return",
      idempotencyKey: `reservation:${reservation.id}:deposit:extra`,
    });
    bank.complete(extra.providerPaymentId!);
    await syncPayment(extra.id, { source: "webhook" });

    const all = await db.select().from(payments).where(eq(payments.reservationId, reservation.id));
    expect(all.find((p) => p.id === first.id)!.status).toBe("succeeded");
    expect(all.find((p) => p.id === extra.id)!.status).toBe("refunded");
    expect((await reservationOf(reservation.id)).status).toBe("confirmed");
    expect((await startDepositPayment(anna, reservation.id)).redirectUrl).toBeNull();
  });

  it("never refunds the accepted deposit when the payment is checked again later", async () => {
    const seated = await booked({ reservationConfirmation: "auto" });
    const paid = await seated.pay();
    const owner = await staffMember(seated.restaurant.id, "o@x.am", "owner");
    await updateReservationStatus(
      owner,
      seated.restaurant.id,
      seated.reservation.id,
      "seat",
      {},
      local("19:00"),
    );
    await syncPayment(paid.id, { source: "reconcile" });
    expect((await latestPayment(seated.reservation.id)).status).toBe("succeeded");

    await truncate(db, ["payment_refunds", "payment_events", "payments", "restaurants", "users"]);
    const lateCancel = await booked({ reservationConfirmation: "auto" });
    const kept = await lateCancel.pay();
    await cancelMyReservation(
      lateCancel.anna,
      lateCancel.reservation.id,
      local("20:00", "2030-01-17"),
    );
    await syncPayment(kept.id, { source: "webhook" });
    expect((await latestPayment(lateCancel.reservation.id)).status).toBe("succeeded");
  });
});
