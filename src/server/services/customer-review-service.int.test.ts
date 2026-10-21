import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { auditLogs, customerReviews, users } from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { orderingSetup, orderRequest } from "@/test/ordering-fixtures";
import {
  guest as signedInGuest,
  local,
  NOW,
  reservationSetup,
  staffMember,
} from "@/test/reservation-fixtures";

import {
  listGivenRatings,
  listMyCustomerReviews,
  listRateableVisitors,
  rateCustomer,
  summarizeCustomerRatings,
} from "./customer-review-service";
import { changeOrderStatus, createOrder } from "./order-service";
import { resolveQrToken } from "./qr-service";
import { placeReservationHold } from "./reservation-hold-service";
import { createReservation, updateReservationStatus } from "./reservation-service";
import { closeTableSession, joinTableSession } from "./table-session-service";

beforeEach(() => truncate(db, ["restaurants", "users", "guests", "rate_limits", "audit_logs"]));

const asCustomer = (user: typeof users.$inferSelect): Customer => ({
  type: "user",
  user: user as unknown as Extract<Customer, { type: "user" }>["user"],
});

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

async function booking() {
  const s = await reservationSetup([4], { reservationConfirmation: "auto" });
  const anna = await signedInGuest("anna@x.am");
  const hold = await placeReservationHold(anna, s.holdInput("19:00"), NOW);
  const reservation = await createReservation(
    anna,
    { holdId: hold.id, contactName: "Anna", contactPhone: "+37491000000" },
    NOW,
  );
  const owner = await staffMember(s.restaurant.id, "owner@x.am", "owner");
  const waiter = await staffMember(s.restaurant.id, "waiter@x.am", "waiter");
  const step = (action: "seat" | "complete" | "no_show", at: string) =>
    updateReservationStatus(owner, s.restaurant.id, reservation.id, action, {}, local(at));
  return { ...s, anna, reservation, owner, waiter, step };
}

describe("rating a customer after a reservation", () => {
  it("is possible once the booking is over, for managers only, and editable", async () => {
    const s = await booking();
    const target = { subject: "reservation" as const, reservationId: s.reservation.id };
    // Not before it's over.
    expect(await codeOf(rateCustomer(s.owner, s.restaurant.id, target, { rating: 5 }))).toBe(
      "CONFLICT",
    );
    await s.step("seat", "19:00");
    await s.step("complete", "21:00");
    const at = local("22:00");

    expect(await codeOf(rateCustomer(s.waiter, s.restaurant.id, target, { rating: 5 }, at))).toBe(
      "FORBIDDEN",
    );
    const first = await rateCustomer(
      s.owner,
      s.restaurant.id,
      target,
      { rating: 4, comment: " Lovely guests " },
      at,
    );
    expect(first).toMatchObject({ rating: 4, comment: "Lovely guests", customerUserId: s.anna.id });
    // Saving again edits the same rating.
    await rateCustomer(s.owner, s.restaurant.id, target, { rating: 5, comment: "" }, at);
    expect(await db.select().from(customerReviews)).toMatchObject([
      { id: first.id, rating: 5, comment: null },
    ]);
    expect(await db.select().from(auditLogs)).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "customer_review.saved" })]),
    );

    // The customer sees it; the restaurant sees its own summary.
    expect(await listMyCustomerReviews(s.anna)).toMatchObject([
      { restaurantName: "Cafe", rating: 5, subject: "reservation" },
    ]);
    expect(
      (await summarizeCustomerRatings(s.owner, s.restaurant.id, [s.anna.id])).get(s.anna.id),
    ).toEqual({ average: 5, count: 1 });
    expect(
      await listGivenRatings(s.owner, s.restaurant.id, { reservationIds: [s.reservation.id] }),
    ).toHaveLength(1);

    // Too late after the window.
    expect(
      await codeOf(
        rateCustomer(s.owner, s.restaurant.id, target, { rating: 3 }, local("22:00", "2030-03-01")),
      ),
    ).toBe("CONFLICT");
  });

  it("covers no-shows, and refuses bad input and other restaurants", async () => {
    const s = await booking();
    await s.step("no_show", "19:30");
    const target = { subject: "reservation" as const, reservationId: s.reservation.id };
    const at = local("20:00");
    for (const bad of [{ rating: 0 }, { rating: 6 }, { rating: 3, comment: "x".repeat(501) }]) {
      expect(await codeOf(rateCustomer(s.owner, s.restaurant.id, target, bad, at))).not.toBeNull();
    }
    await rateCustomer(s.owner, s.restaurant.id, target, { rating: 1, comment: "No-show" }, at);

    const [stranger] = await db.insert(users).values({ email: "x@x.am" }).returning();
    // Other people don't even learn the restaurant exists.
    expect(await codeOf(rateCustomer(stranger!, s.restaurant.id, target, { rating: 5 }, at))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(summarizeCustomerRatings(stranger!, s.restaurant.id, [s.anna.id]))).toBe(
      "NOT_FOUND",
    );
    expect(
      await codeOf(
        rateCustomer(
          s.owner,
          s.restaurant.id,
          { subject: "reservation", reservationId: "x" },
          {
            rating: 5,
          },
        ),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("rating a customer after a table visit", () => {
  it("rates signed-in guests who were served, once the visit ended", async () => {
    const s = await orderingSetup();
    const [anna] = await db.insert(users).values({ email: "anna@x.am", name: "Anna" }).returning();
    const me = asCustomer(anna!);
    await joinTableSession(me, (await resolveQrToken(s.token))!);
    const order = await createOrder(me, s.session.id, orderRequest(s, "anna-order-0001"));
    const target = {
      subject: "visit" as const,
      tableSessionId: s.session.id,
      customerUserId: anna!.id,
    };
    // Not served yet.
    expect(await codeOf(rateCustomer(s.owner, s.restaurantId, target, { rating: 5 }))).toBe(
      "NOT_FOUND",
    );
    for (const to of ["accepted", "ready", "served"] as const) {
      await changeOrderStatus(s.owner, s.restaurantId, order.id, to);
    }
    // Still sitting.
    expect(await codeOf(rateCustomer(s.owner, s.restaurantId, target, { rating: 5 }))).toBe(
      "CONFLICT",
    );
    expect(await listRateableVisitors(s.owner, s.restaurantId, s.session.id)).toEqual([
      { userId: anna!.id, name: "Anna" },
    ]);
    await closeTableSession(s.owner, s.restaurantId, s.session.id);
    await rateCustomer(s.owner, s.restaurantId, target, { rating: 4 });
    expect(await listMyCustomerReviews(anna!)).toMatchObject([{ rating: 4, subject: "visit" }]);
    expect(
      await listGivenRatings(s.owner, s.restaurantId, { tableSessionIds: [s.session.id] }),
    ).toMatchObject([{ customerUserId: anna!.id, rating: 4 }]);
  });
});
