import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { paymentEvents, payments, restaurants } from "@/server/db/schema";
import { createFakeProvider, type FakeProvider } from "@/server/payments/fake-provider";
import { setPaymentProviderForTests } from "@/server/payments/registry";
import { truncate } from "@/test/db";

import { startPayment, syncPayment } from "./payment-service";

let bank: FakeProvider;
afterAll(() => setPaymentProviderForTests(undefined));

beforeEach(async () => {
  await truncate(db, ["payment_events", "payments", "restaurants", "users"]);
  bank = createFakeProvider();
  setPaymentProviderForTests(bank);
});

async function restaurant() {
  const [row] = await db
    .insert(restaurants)
    .values({ name: "Cafe", slug: "cafe", status: "active" })
    .returning();
  return row!;
}

const input = (restaurantId: string, overrides = {}) => ({
  restaurantId,
  purpose: "bill" as const,
  customerUserId: null,
  amountMinor: 1_250_000,
  currency: "AMD",
  description: "Bill #12",
  returnUrl: "https://spot.test/pay/return",
  idempotencyKey: "bill:12:attempt-1",
  ...overrides,
});

const events = async (paymentId: string) =>
  (
    await db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.paymentId, paymentId))
      .orderBy(paymentEvents.createdAt)
  ).map((e) => [e.type, e.fromStatus, e.toStatus]);

describe("startPayment", () => {
  it("creates a pending payment and its provider side, with a page to pay on", async () => {
    const r = await restaurant();
    const { payment, redirectUrl } = await startPayment(input(r.id));
    expect(payment).toMatchObject({
      status: "pending",
      provider: "fake",
      amountMinor: 1_250_000,
      currency: "AMD",
      refundedMinor: 0,
    });
    expect(payment.providerPaymentId).toMatch(/^fake_/);
    expect(redirectUrl).toContain(payment.providerPaymentId);
    expect(await events(payment.id)).toEqual([["created", null, "pending"]]);
  });

  it("reuses the payment for a retried request instead of charging twice", async () => {
    const r = await restaurant();
    const [a, b] = await Promise.all([startPayment(input(r.id)), startPayment(input(r.id))]);
    expect(b.payment.id).toBe(a.payment.id);
    expect(b.payment.providerPaymentId).toBe(a.payment.providerPaymentId);
    expect(await db.select().from(payments)).toHaveLength(1);
    expect(await events(a.payment.id)).toEqual([["created", null, "pending"]]);
  });

  it("refuses the same key with different terms", async () => {
    const r = await restaurant();
    await startPayment(input(r.id));
    await expect(startPayment(input(r.id, { amountMinor: 100 }))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("validates amounts and requires a reservation for deposits", async () => {
    const r = await restaurant();
    await expect(startPayment(input(r.id, { amountMinor: 0 }))).rejects.toThrow();
    await expect(startPayment(input(r.id, { amountMinor: 10.5 }))).rejects.toThrow();
    await expect(
      startPayment(input(r.id, { purpose: "reservation_deposit", idempotencyKey: "deposit-x1" })),
    ).rejects.toThrow();
  });
});

describe("syncPayment", () => {
  it("marks a payment paid only when the provider says so", async () => {
    const r = await restaurant();
    const { payment } = await startPayment(input(r.id));
    expect((await syncPayment(payment.id, { source: "return" })).outcome).toBe("unchanged");

    bank.complete(payment.providerPaymentId!);
    const { payment: paid, outcome } = await syncPayment(payment.id, { source: "return" });
    expect(outcome).toBe("changed");
    expect(paid).toMatchObject({ status: "succeeded" });
    expect(paid.succeededAt).toBeInstanceOf(Date);
    expect(await events(payment.id)).toEqual([
      ["created", null, "pending"],
      ["status_changed", "pending", "succeeded"],
    ]);
  });

  it("records a decline with its reason", async () => {
    const r = await restaurant();
    const { payment } = await startPayment(input(r.id));
    bank.fail(payment.providerPaymentId!, "insufficient_funds");
    expect((await syncPayment(payment.id, { source: "return" })).payment).toMatchObject({
      status: "failed",
      failureReason: "insufficient_funds",
    });
  });

  it("applies each provider event once, however often it's delivered", async () => {
    const r = await restaurant();
    const { payment } = await startPayment(input(r.id));
    bank.complete(payment.providerPaymentId!);
    const deliveries = await Promise.all(
      [1, 2, 3].map(() => syncPayment(payment.id, { source: "webhook", providerEventId: "evt_1" })),
    );
    expect(deliveries.map((d) => d.outcome).sort()).toEqual(["changed", "duplicate", "duplicate"]);
    expect((await events(payment.id)).filter(([type]) => type === "status_changed")).toHaveLength(
      1,
    );
  });

  it("never lets a late message undo a success", async () => {
    const r = await restaurant();
    const { payment } = await startPayment(input(r.id));
    bank.complete(payment.providerPaymentId!);
    await syncPayment(payment.id, { source: "return" });
    bank.tamper(payment.providerPaymentId!, { status: "pending" });
    const { payment: after, outcome } = await syncPayment(payment.id, { source: "reconcile" });
    expect(outcome).toBe("ignored");
    expect(after.status).toBe("succeeded");
  });

  it("refuses to mark paid when the provider reports a different amount", async () => {
    const r = await restaurant();
    const { payment } = await startPayment(input(r.id));
    bank.tamper(payment.providerPaymentId!, { status: "succeeded", amountMinor: 100 });
    const { payment: after, outcome } = await syncPayment(payment.id, { source: "webhook" });
    expect(outcome).toBe("mismatch");
    expect(after).toMatchObject({ status: "failed", failureReason: "amount_mismatch" });
  });
});

describe("payments are financial records", () => {
  it("can't be deleted, and their amount and currency can't change", async () => {
    const r = await restaurant();
    const { payment } = await startPayment(input(r.id));
    await expect(db.delete(payments).where(eq(payments.id, payment.id))).rejects.toThrow();
    await expect(
      db.update(payments).set({ amountMinor: 1 }).where(eq(payments.id, payment.id)),
    ).rejects.toThrow();
    await expect(
      db.update(payments).set({ currency: "USD" }).where(eq(payments.id, payment.id)),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`UPDATE payment_events SET type = 'x' WHERE payment_id = ${payment.id}`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`DELETE FROM payment_events WHERE payment_id = ${payment.id}`),
    ).rejects.toThrow();
  });
});
