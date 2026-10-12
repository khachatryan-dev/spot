import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { emailMessages, notifications, reservations, users } from "@/server/db/schema";
import { type OutgoingEmail, setEmailSenderForTests } from "@/server/email/sender";
import { createFakeProvider, type FakeProvider } from "@/server/payments/fake-provider";
import { setPaymentProviderForTests } from "@/server/payments/registry";
import {
  listNotifications,
  markAllRead,
  sendEmail,
  unreadCount,
} from "@/server/services/notification-service";
import { placeReservationHold } from "@/server/services/reservation-hold-service";
import {
  cancelMyReservation,
  createReservation,
  updateReservationStatus,
} from "@/server/services/reservation-service";
import { truncate } from "@/test/db";
import { guest, local, NOW, reservationSetup, staffMember } from "@/test/reservation-fixtures";

import { refundPayment } from "@/server/services/refund-service";
import { syncPayment } from "@/server/services/payment-service";
import { startDepositPayment } from "@/server/services/reservation-deposit-service";
import { payments, reviews } from "@/server/db/schema";
import { respondToReview } from "@/server/services/restaurant-review-service";
import { createReview, verifyReviewEmail } from "@/server/services/review-service";
import { closeTableSession } from "@/server/services/table-session-service";
import { changeOrderStatus, createOrder } from "@/server/services/order-service";
import { orderingSetup, orderRequest } from "@/test/ordering-fixtures";

import { sendReservationReminders } from "./reservation-notices";

let outbox: OutgoingEmail[] = [];
let failNext = false;
setEmailSenderForTests({
  name: "test",
  async send(email) {
    if (failNext) {
      failNext = false;
      throw new Error("SMTP down");
    }
    outbox.push(email);
  },
});
let bank: FakeProvider;
afterAll(() => {
  setEmailSenderForTests(undefined);
  setPaymentProviderForTests(undefined);
});
beforeEach(async () => {
  await truncate(db, [
    "restaurants",
    "users",
    "rate_limits",
    "email_messages",
    "payments",
    "audit_logs",
  ]);
  outbox = [];
  bank = createFakeProvider();
  setPaymentProviderForTests(bank);
});

const contact = { contactName: "Anna", contactPhone: "+37491000000" };

async function booking(overrides = {}) {
  const s = await reservationSetup([4], overrides);
  const anna = await guest("anna@x.am");
  await db.update(users).set({ preferredLocale: "en" }).where(eq(users.id, anna.id));
  const owner = await staffMember(s.restaurant.id, "owner@x.am", "owner");
  const manager = await staffMember(s.restaurant.id, "manager@x.am", "manager");
  const waiter = await staffMember(s.restaurant.id, "waiter@x.am", "waiter");
  const hold = await placeReservationHold(anna, s.holdInput("19:00"), NOW);
  const reservation = await createReservation(anna, { holdId: hold.id, ...contact }, NOW);
  return { ...s, anna, owner, manager, waiter, reservation };
}

const typesFor = async (userId: string) =>
  (await listNotifications({ id: userId })).map((n) => n.type);

describe("booking notifications", () => {
  it("tells the owner and manager (not waiters) about a request, and emails the guest", async () => {
    const b = await booking();
    expect(await typesFor(b.owner.id)).toEqual(["reservation_requested"]);
    expect(await typesFor(b.manager.id)).toEqual(["reservation_requested"]);
    expect(await typesFor(b.waiter.id)).toEqual([]);
    const [notice] = await listNotifications(b.owner);
    expect(notice).toMatchObject({
      restaurantId: b.restaurant.id,
      data: { restaurant: "Cafe", guest: "Anna", party: 2, timezone: "Asia/Yerevan" },
    });
    expect(notice!.link).toContain(`/dashboard/r/${b.restaurant.id}/reservations?location=`);
    expect(outbox.map((e) => [e.to, e.subject])).toEqual([["anna@x.am", "Request sent: Cafe"]]);
    expect(outbox[0]!.text).toContain("Hello, Anna!");
    const [logged] = await db.select().from(emailMessages);
    expect(logged).toMatchObject({
      template: "reservation_received",
      locale: "en",
      status: "sent",
    });
  });

  it("emails a confirmation straight away when the location auto-confirms", async () => {
    const b = await booking({ reservationConfirmation: "auto" });
    expect(await typesFor(b.owner.id)).toEqual([]);
    expect(outbox.map((e) => e.subject)).toEqual([expect.stringMatching(/^Confirmed: Cafe, /)]);
  });

  it("tells the guest when the restaurant confirms, declines or cancels", async () => {
    const b = await booking();
    outbox = [];
    await updateReservationStatus(
      b.manager,
      b.restaurant.id,
      b.reservation.id,
      "decline",
      {
        reason: "Private event",
      },
      NOW,
    );
    expect(await typesFor(b.anna.id)).toEqual(["reservation_declined"]);
    expect(outbox[0]!.subject).toBe("Not available: Cafe");
    expect(outbox[0]!.text).toContain("Reason: Private event");
    expect(outbox[0]!.text).toContain("/r/cafe");
  });

  it("tells staff when the guest cancels", async () => {
    const b = await booking({ reservationConfirmation: "auto" });
    await cancelMyReservation(b.anna, b.reservation.id, NOW);
    expect(await typesFor(b.owner.id)).toEqual(["reservation_cancelled_by_guest"]);
  });

  it("emails a reminder once on the day", async () => {
    const b = await booking({ reservationConfirmation: "auto" });
    outbox = [];
    expect(await sendReservationReminders(local("08:00"))).toBe(1);
    expect(outbox[0]!.subject).toBe("Today: Cafe at 19:00");
    expect(await sendReservationReminders(local("09:00"))).toBe(0);
    const [row] = await db.select().from(reservations).where(eq(reservations.id, b.reservation.id));
    expect(row!.reminderSentAt).toEqual(local("08:00"));
  });
});

describe("in-app inbox and email outbox", () => {
  it("counts unread notices and marks them read", async () => {
    const b = await booking();
    expect(await unreadCount(b.owner)).toBe(1);
    await markAllRead(b.owner);
    expect(await unreadCount(b.owner)).toBe(0);
    expect(await unreadCount(b.manager)).toBe(1);
    const [read] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, b.owner.id));
    expect(read!.readAt).toBeInstanceOf(Date);
  });

  it("records a failed delivery without breaking anything", async () => {
    failNext = true;
    await sendEmail({
      to: "x@x.am",
      template: "refund_issued",
      locale: "hy",
      values: { name: "", restaurant: "Cafe", amount: "1 000 ֏" },
    });
    const [row] = await db.select().from(emailMessages);
    expect(row).toMatchObject({ status: "failed", attempts: 1, subject: "Վերադարձ Cafe-ից" });
    expect(row!.lastError).toContain("SMTP down");
  });
});

describe("payment and review notices", () => {
  it("tells the guest their deposit was paid and later refunded", async () => {
    const b = await booking({
      reservationDepositType: "per_booking",
      reservationDepositMinor: 500_000,
    });
    await startDepositPayment(b.anna, b.reservation.id);
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.reservationId, b.reservation.id));
    bank.complete(payment!.providerPaymentId!);
    await syncPayment(payment!.id, { source: "return" });
    expect(await typesFor(b.anna.id)).toEqual(["deposit_paid"]);
    expect(await typesFor(b.owner.id)).toEqual(["reservation_requested"]); // after payment, not before

    outbox = [];
    await refundPayment(b.owner, b.restaurant.id, payment!.id, {
      amountMinor: 500_000,
      reason: "Goodwill gesture",
      idempotencyKey: "refund-notice-1",
    });
    expect((await typesFor(b.anna.id))[0]).toBe("refund_issued");
    expect(outbox.map((e) => e.subject)).toEqual(["Refund from Cafe"]);
  });

  it("tells a signed-in author when the restaurant replies", async () => {
    const s = await orderingSetup();
    const order = await createOrder(s.ani, s.session.id, orderRequest(s));
    for (const to of ["accepted", "ready", "served"] as const) {
      await changeOrderStatus(s.owner, s.restaurantId, order.id, to);
    }
    await closeTableSession(s.owner, s.restaurantId, s.session.id);
    const review = await createReview(s.ani, {
      subject: "visit",
      targetId: s.session.id,
      rating: 4,
      email: "ani@x.am",
      locale: "en",
    });
    // Anonymous author: a confirmation link by email.
    const verify = outbox.find((e) => e.subject === "Confirm your review of Order Cafe")!;
    const token = /\/reviews\/verify\/([A-Za-z0-9_-]+)/.exec(verify.text)![1]!;
    expect(verify.to).toBe("ani@x.am");
    expect(await verifyReviewEmail("not-the-token-at-all-000000")).toBe(false);
    expect(await verifyReviewEmail(token)).toBe(true);
    expect(await verifyReviewEmail(token)).toBe(false); // used up
    const [row] = await db.select().from(reviews).where(eq(reviews.id, review.id));
    expect(row!.authorEmailVerifiedAt).toBeInstanceOf(Date);
    expect(row!.emailTokenHash).toBeNull();

    // Replies notify accounts (anonymous authors have none).
    const [author] = await db.insert(users).values({ email: "author@x.am" }).returning();
    await db
      .update(reviews)
      .set({ authorGuestId: null, authorUserId: author!.id })
      .where(eq(reviews.id, review.id));
    await respondToReview(s.owner, s.restaurantId, review.id, "Thank you!");
    expect(await typesFor(author!.id)).toEqual(["review_replied"]);
  });
});
