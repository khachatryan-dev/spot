import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { bills, reservations, reviews, users } from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { createFakeProvider } from "@/server/payments/fake-provider";
import { setPaymentProviderForTests } from "@/server/payments/registry";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { guest, orderingSetup, orderRequest } from "@/test/ordering-fixtures";
import {
  guest as signedInGuest,
  local,
  NOW,
  reservationSetup,
  staffMember,
} from "@/test/reservation-fixtures";

import { recordBillPayment } from "./bill-payment-service";
import { finalizeBill } from "./bill-service";
import { changeOrderStatus, createOrder } from "./order-service";
import { placeReservationHold } from "./reservation-hold-service";
import { createReservation, updateReservationStatus } from "./reservation-service";
import {
  createReview,
  deleteMyReview,
  getReviewSummary,
  listMyReviews,
  listReviewOpportunities,
  updateMyReview,
} from "./review-service";
import { closeTableSession } from "./table-session-service";

afterAll(() => setPaymentProviderForTests(undefined));
beforeEach(async () => {
  await truncate(db, ["restaurants", "users", "guests", "rate_limits", "payments"]);
  setPaymentProviderForTests(createFakeProvider());
});

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

/** Ani (an anonymous guest) at table 3 orders; the kitchen serves it. */
async function servedVisit() {
  const s = await orderingSetup();
  const order = await createOrder(s.ani, s.session.id, orderRequest(s));
  for (const to of ["accepted", "ready", "served"] as const) {
    await changeOrderStatus(s.owner, s.restaurantId, order.id, to);
  }
  const visit = (who: Customer = s.ani, extra = {}) =>
    createReview(who, {
      subject: "visit",
      targetId: s.session.id,
      rating: 5,
      comment: "  Great khorovats  ",
      email: "Ani@Example.am",
      ...extra,
    });
  return { ...s, order, visit };
}

describe("reviewing a table visit", () => {
  it("is possible only once the visit has ended", async () => {
    const s = await servedVisit();
    expect(await listReviewOpportunities(s.ani)).toEqual([]);
    expect(await codeOf(s.visit())).toBe("NOT_FOUND");

    await closeTableSession(s.owner, s.restaurantId, s.session.id);
    const [opportunity] = await listReviewOpportunities(s.ani);
    expect(opportunity).toMatchObject({
      subject: "visit",
      targetId: s.session.id,
      restaurantName: "Order Cafe",
      locationName: "Main",
    });
  });

  it("publishes an anonymous guest's review with their email, once", async () => {
    const s = await servedVisit();
    await closeTableSession(s.owner, s.restaurantId, s.session.id);
    expect(await codeOf(s.visit(s.ani, { email: "" }))).toBe("VALIDATION_ERROR");

    const review = await s.visit(s.ani, { displayName: "Ani" });
    expect(review).toMatchObject({
      status: "published",
      rating: 5,
      comment: "Great khorovats",
      authorEmail: "ani@example.am",
      displayName: "Ani",
      subject: "visit",
      authorGuestId: (s.ani as Extract<Customer, { type: "guest" }>).guest.id,
    });
    expect(review.publishedAt).toBeInstanceOf(Date);
    expect(await codeOf(s.visit())).toBe("NOT_FOUND"); // no longer offered
    expect(await listReviewOpportunities(s.ani)).toEqual([]);
  });

  it("counts a paid bill as the end of the visit", async () => {
    const s = await servedVisit();
    await finalizeBill(s.owner, s.restaurantId, s.session.id);
    const [bill] = await db.select().from(bills).where(eq(bills.tableSessionId, s.session.id));
    await recordBillPayment(s.owner, s.restaurantId, bill!.id, { mode: "full", method: "cash" });
    expect(await listReviewOpportunities(s.ani)).toHaveLength(1);
  });

  it("isn't offered to guests who weren't served, or weren't there", async () => {
    const s = await orderingSetup();
    const order = await createOrder(s.ani, s.session.id, orderRequest(s));
    await changeOrderStatus(s.owner, s.restaurantId, order.id, "cancelled", {
      reason: "Out of stock",
    });
    await closeTableSession(s.owner, s.restaurantId, s.session.id);
    expect(await listReviewOpportunities(s.ani)).toEqual([]);

    const stranger = await guest();
    expect(
      await codeOf(
        createReview(stranger, {
          subject: "visit",
          targetId: s.session.id,
          rating: 1,
          email: "troll@example.am",
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("closes after 30 days", async () => {
    const s = await servedVisit();
    await closeTableSession(s.owner, s.restaurantId, s.session.id);
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(await listReviewOpportunities(s.ani, later)).toEqual([]);
    expect(
      await codeOf(
        createReview(
          s.ani,
          { subject: "visit", targetId: s.session.id, rating: 4, email: "a@x.am" },
          later,
        ),
      ),
    ).toBe("NOT_FOUND");
  });

  it("validates the rating and comment", async () => {
    const s = await servedVisit();
    await closeTableSession(s.owner, s.restaurantId, s.session.id);
    for (const bad of [
      { rating: 0 },
      { rating: 6 },
      { rating: 4.5 },
      { comment: "x".repeat(2001) },
    ]) {
      expect(await codeOf(s.visit(s.ani, bad))).not.toBeNull();
    }
    expect(await db.select().from(reviews)).toHaveLength(0);
  });
});

describe("reviewing a reservation", () => {
  async function completed() {
    const s = await reservationSetup([4], { reservationConfirmation: "auto" });
    const anna = await signedInGuest("anna@x.am");
    await db.update(users).set({ name: "Anna" }).where(eq(users.id, anna.id));
    const hold = await placeReservationHold(anna, s.holdInput("19:00"), NOW);
    const reservation = await createReservation(
      anna,
      { holdId: hold.id, contactName: "Anna", contactPhone: "+37491000000" },
      NOW,
    );
    const owner = await staffMember(s.restaurant.id, "owner@x.am", "owner");
    const step = (action: "seat" | "complete", at: string) =>
      updateReservationStatus(owner, s.restaurant.id, reservation.id, action, {}, local(at));
    const customer: Customer = {
      type: "user",
      user: { ...anna, name: "Anna" } as Extract<Customer, { type: "user" }>["user"],
    };
    return { ...s, anna: customer, reservation, step };
  }

  it("is offered to the signed-in guest once the reservation is completed", async () => {
    const s = await completed();
    const after = local("23:00");
    expect(await listReviewOpportunities(s.anna, after)).toEqual([]);
    await s.step("seat", "19:00");
    expect(await listReviewOpportunities(s.anna, after)).toEqual([]);
    await s.step("complete", "21:00");
    const [opportunity] = await listReviewOpportunities(s.anna, after);
    expect(opportunity).toMatchObject({ subject: "reservation", targetId: s.reservation.id });

    const review = await createReview(
      s.anna,
      { subject: "reservation", targetId: s.reservation.id, rating: 4 },
      after,
    );
    expect(review).toMatchObject({
      displayName: "Anna",
      authorEmail: null,
      rating: 4,
      comment: null,
    });
    expect(
      await codeOf(
        createReview(
          s.anna,
          { subject: "reservation", targetId: s.reservation.id, rating: 5 },
          after,
        ),
      ),
    ).toBe("NOT_FOUND");
  });

  it("isn't offered for no-shows or cancellations, nor to anyone else", async () => {
    const s = await completed();
    await db
      .update(reservations)
      .set({ status: "no_show", noShowAt: local("19:30") })
      .where(eq(reservations.id, s.reservation.id));
    expect(await listReviewOpportunities(s.anna, local("23:00"))).toEqual([]);
    const other = await guest();
    expect(
      await codeOf(
        createReview(other, {
          subject: "reservation",
          targetId: s.reservation.id,
          rating: 5,
          email: "x@x.am",
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("public summary and authors' own reviews", () => {
  it("averages published reviews only, latest first, with the restaurant's reply", async () => {
    const s = await servedVisit();
    await closeTableSession(s.owner, s.restaurantId, s.session.id);
    const review = await s.visit(s.ani, { rating: 4, displayName: "Ani" });
    await db
      .update(reviews)
      .set({ response: "Thank you, Ani!", respondedAt: new Date() })
      .where(eq(reviews.id, review.id));
    expect(await getReviewSummary(s.restaurantId)).toMatchObject({
      average: 4,
      count: 1,
      recent: [
        { displayName: "Ani", rating: 4, comment: "Great khorovats", response: "Thank you, Ani!" },
      ],
    });
    await db.update(reviews).set({ status: "hidden" }).where(eq(reviews.id, review.id));
    expect(await getReviewSummary(s.restaurantId)).toMatchObject({
      average: null,
      count: 0,
      recent: [],
    });
  });

  it("lets signed-in authors edit and delete only their own reviews", async () => {
    const s = await servedVisit();
    await closeTableSession(s.owner, s.restaurantId, s.session.id);
    const review = await s.visit();
    // Reviews by anonymous guests can't be edited through an account.
    const [someone] = await db.insert(users).values({ email: "someone@x.am" }).returning();
    expect(await codeOf(updateMyReview(someone!, review.id, { rating: 1 }))).toBe("NOT_FOUND");
    expect(await codeOf(deleteMyReview(someone!, review.id))).toBe("NOT_FOUND");

    await db
      .update(reviews)
      .set({ authorGuestId: null, authorUserId: someone!.id })
      .where(eq(reviews.id, review.id));
    expect(
      await updateMyReview(someone!, review.id, { rating: 2, comment: "Changed my mind" }),
    ).toMatchObject({
      rating: 2,
      comment: "Changed my mind",
    });
    expect(await listMyReviews(someone!)).toMatchObject([
      { restaurantName: "Order Cafe", rating: 2 },
    ]);

    await db.update(reviews).set({ status: "rejected" }).where(eq(reviews.id, review.id));
    expect(await codeOf(updateMyReview(someone!, review.id, { rating: 5 }))).toBe("NOT_FOUND");
    await deleteMyReview(someone!, review.id);
    expect(await db.select().from(reviews)).toHaveLength(0);
  });
});
