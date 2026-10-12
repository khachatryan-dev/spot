import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { auditLogs, paymentRefunds, payments, restaurants } from "@/server/db/schema";
import { createFakeProvider, type FakeProvider } from "@/server/payments/fake-provider";
import { setPaymentProviderForTests } from "@/server/payments/registry";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { staffMember } from "@/test/reservation-fixtures";

import { startPayment, syncPayment } from "./payment-service";
import { refundPayment } from "./refund-service";

let bank: FakeProvider;
afterAll(() => setPaymentProviderForTests(undefined));
beforeEach(async () => {
  await truncate(db, [
    "payment_refunds",
    "payment_events",
    "payments",
    "restaurants",
    "users",
    "audit_logs",
  ]);
  bank = createFakeProvider();
  setPaymentProviderForTests(bank);
});

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

let keys = 0;
const refund = (amountMinor: number, overrides = {}) => ({
  amountMinor,
  reason: "Dish was cold",
  idempotencyKey: `refund-key-${++keys}`,
  ...overrides,
});

/** A paid 10 000 ֏ payment and a manager who may refund it. */
async function paid() {
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: "Cafe", slug: "cafe", status: "active" })
    .returning();
  const { payment } = await startPayment({
    restaurantId: restaurant!.id,
    purpose: "bill",
    customerUserId: null,
    amountMinor: 1_000_000,
    currency: "AMD",
    description: "Bill",
    returnUrl: "https://spot.test/return",
    idempotencyKey: `bill:${restaurant!.id}`,
  });
  bank.complete(payment.providerPaymentId!);
  await syncPayment(payment.id, { source: "return" });
  const manager = await staffMember(restaurant!.id, "manager@x.am", "manager");
  const refundAs = (who: { id: string }, input: ReturnType<typeof refund>) =>
    refundPayment(who, restaurant!.id, payment.id, input);
  return { restaurant: restaurant!, payment, manager, refundAs };
}

describe("refundPayment", () => {
  it("refunds part, then the rest, updating the payment each time", async () => {
    const { manager, refundAs, payment } = await paid();
    const first = await refundAs(manager, refund(400_000));
    expect(first.refund).toMatchObject({ status: "succeeded", amountMinor: 400_000 });
    expect(first.payment).toMatchObject({ status: "partially_refunded", refundedMinor: 400_000 });

    const second = await refundAs(manager, refund(600_000));
    expect(second.payment).toMatchObject({ status: "refunded", refundedMinor: 1_000_000 });
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, payment.id));
    expect(audit.map((a) => a.action)).toEqual(["payment.refunded", "payment.refunded"]);
    expect(audit[0]!.metadata).toMatchObject({ amountMinor: 400_000, reason: "Dish was cold" });
  });

  it("never refunds more than was paid", async () => {
    const { manager, refundAs } = await paid();
    expect(await codeOf(refundAs(manager, refund(1_000_001)))).toBe("CONFLICT");
    await refundAs(manager, refund(700_000));
    expect(await codeOf(refundAs(manager, refund(300_001)))).toBe("CONFLICT");
    expect(await codeOf(refundAs(manager, refund(300_000)))).toBeNull();
  });

  it("lets only one of two simultaneous large refunds through", async () => {
    const { manager, refundAs, payment } = await paid();
    const results = await Promise.all([
      codeOf(refundAs(manager, refund(600_000))),
      codeOf(refundAs(manager, refund(600_000))),
    ]);
    expect(results.sort()).toEqual(["CONFLICT", null].sort());
    const [after] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(after!.refundedMinor).toBe(600_000);
  });

  it("refunds once when the same request is sent twice", async () => {
    const { manager, refundAs } = await paid();
    const same = refund(250_000);
    const [a, b] = await Promise.all([refundAs(manager, same), refundAs(manager, same)]);
    expect(b.refund.id).toBe(a.refund.id);
    expect(await db.select().from(paymentRefunds)).toHaveLength(1);
    const [after] = await db.select().from(payments);
    expect(after!.refundedMinor).toBe(250_000);
    expect(await codeOf(refundAs(manager, { ...same, amountMinor: 1 }))).toBe("CONFLICT");
  });

  it("leaves the payment unchanged when the provider declines, and frees the amount", async () => {
    const { manager, refundAs } = await paid();
    bank.failNextRefund();
    const declined = await refundAs(manager, refund(1_000_000));
    expect(declined.refund.status).toBe("failed");
    expect(declined.payment).toMatchObject({ status: "succeeded", refundedMinor: 0 });
    expect((await refundAs(manager, refund(1_000_000))).payment.status).toBe("refunded");
  });

  it("can be retried safely after the provider call fails mid-way", async () => {
    const { manager, refundAs } = await paid();
    const attempt = refund(500_000);
    bank.throwNextRefund();
    expect(await codeOf(refundAs(manager, attempt))).toBe("RESOURCE_UNAVAILABLE");
    // Pending: its amount is still reserved.
    expect(await codeOf(refundAs(manager, refund(600_000)))).toBe("CONFLICT");
    const retried = await refundAs(manager, attempt);
    expect(retried.refund.status).toBe("succeeded");
    expect(retried.payment.refundedMinor).toBe(500_000);
  });

  it("refuses unpaid payments, missing reasons, other roles and other restaurants", async () => {
    const { manager, refundAs, restaurant, payment } = await paid();
    expect(await codeOf(refundAs(manager, refund(100, { reason: "" })))).toContain(
      "reasonTooShort",
    );
    const waiter = await staffMember(restaurant.id, "w@x.am", "waiter");
    expect(await codeOf(refundAs(waiter, refund(100)))).toBe("FORBIDDEN");

    const [other] = await db
      .insert(restaurants)
      .values({ name: "Other", slug: "other", status: "active" })
      .returning();
    const theirOwner = await staffMember(other!.id, "o@x.am", "owner");
    expect(await codeOf(refundPayment(theirOwner, other!.id, payment.id, refund(100)))).toBe(
      "NOT_FOUND",
    );

    const { payment: unpaid } = await startPayment({
      restaurantId: restaurant.id,
      purpose: "bill",
      customerUserId: null,
      amountMinor: 5_000,
      currency: "AMD",
      description: "Bill",
      returnUrl: "https://spot.test/return",
      idempotencyKey: "bill:unpaid",
    });
    expect(await codeOf(refundPayment(manager, restaurant.id, unpaid.id, refund(100)))).toBe(
      "CONFLICT",
    );
  });

  it("keeps refunds as permanent records", async () => {
    const { manager, refundAs } = await paid();
    const { refund: done } = await refundAs(manager, refund(100_000));
    await expect(db.delete(paymentRefunds).where(eq(paymentRefunds.id, done.id))).rejects.toThrow();
    await expect(
      db.update(paymentRefunds).set({ amountMinor: 1 }).where(eq(paymentRefunds.id, done.id)),
    ).rejects.toThrow();
    await expect(
      db.update(paymentRefunds).set({ status: "failed" }).where(eq(paymentRefunds.id, done.id)),
    ).rejects.toThrow();
  });
});
