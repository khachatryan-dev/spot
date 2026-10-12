import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { paymentEvents, payments, restaurants } from "@/server/db/schema";
import { createFakeProvider, type FakeProvider } from "@/server/payments/fake-provider";
import { setPaymentProviderForTests } from "@/server/payments/registry";
import { startPayment } from "@/server/services/payment-service";
import { truncate } from "@/test/db";

import { POST } from "./route";

let bank: FakeProvider;
afterAll(() => setPaymentProviderForTests(undefined));
beforeEach(async () => {
  await truncate(db, ["payment_events", "payments", "restaurants"]);
  bank = createFakeProvider();
  setPaymentProviderForTests(bank);
});

const deliver = (request: Request, provider = "fake") =>
  POST(request, { params: Promise.resolve({ provider }) });

async function pendingPayment() {
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: "Cafe", slug: "cafe", status: "active" })
    .returning();
  const { payment } = await startPayment({
    restaurantId: restaurant!.id,
    purpose: "bill",
    customerUserId: null,
    amountMinor: 500_000,
    currency: "AMD",
    description: "Bill",
    returnUrl: "https://spot.test/return",
    idempotencyKey: "bill:webhook-test",
  });
  return payment;
}

const statusOf = async (id: string) =>
  (await db.select().from(payments).where(eq(payments.id, id)))[0]!.status;

describe("POST /api/payments/webhooks/[provider]", () => {
  it("applies a signed event after re-checking the payment with the provider", async () => {
    const payment = await pendingPayment();
    bank.complete(payment.providerPaymentId!);
    const response = await deliver(
      bank.webhookRequest({
        eventId: "evt_1",
        providerPaymentId: payment.providerPaymentId!,
        type: "payment.succeeded",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { outcome: "changed" }, error: null });
    expect(await statusOf(payment.id)).toBe("succeeded");
  });

  it("trusts the provider's record, not the webhook's claim", async () => {
    const payment = await pendingPayment();
    // Signed, but the bank hasn't actually taken the money.
    const response = await deliver(
      bank.webhookRequest({
        eventId: "evt_early",
        providerPaymentId: payment.providerPaymentId!,
        type: "payment.succeeded",
      }),
    );
    expect((await response.json()).data.outcome).toBe("unchanged");
    expect(await statusOf(payment.id)).toBe("pending");
  });

  it("rejects bad signatures without touching the payment", async () => {
    const payment = await pendingPayment();
    bank.complete(payment.providerPaymentId!);
    const forged = new Request("https://spot.test/api/payments/webhooks/fake", {
      method: "POST",
      headers: { "x-fake-signature": "00".repeat(32) },
      body: JSON.stringify({ eventId: "evt_x", providerPaymentId: payment.providerPaymentId }),
    });
    const response = await deliver(forged);
    expect(response.status).toBe(401);
    expect(await statusOf(payment.id)).toBe("pending");
    expect(
      await db.select().from(paymentEvents).where(eq(paymentEvents.type, "webhook_received")),
    ).toHaveLength(0);
  });

  it("handles redelivery of the same event once", async () => {
    const payment = await pendingPayment();
    bank.complete(payment.providerPaymentId!);
    const event = {
      eventId: "evt_dup",
      providerPaymentId: payment.providerPaymentId!,
      type: "payment.succeeded",
    };
    const responses = await Promise.all([1, 2, 3].map(() => deliver(bank.webhookRequest(event))));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const outcomes = await Promise.all(responses.map(async (r) => (await r.json()).data.outcome));
    expect(outcomes.sort()).toEqual(["changed", "duplicate", "duplicate"]);
    expect(
      await db.select().from(paymentEvents).where(eq(paymentEvents.type, "status_changed")),
    ).toHaveLength(1);
  });

  it("stays correct when events arrive out of order", async () => {
    const payment = await pendingPayment();
    const id = payment.providerPaymentId!;
    bank.complete(id);
    await deliver(
      bank.webhookRequest({ eventId: "evt_2", providerPaymentId: id, type: "succeeded" }),
    );
    // The older "processing" event arrives late; the bank still says succeeded.
    const late = await deliver(
      bank.webhookRequest({ eventId: "evt_1", providerPaymentId: id, type: "processing" }),
    );
    expect(late.status).toBe(200);
    expect(await statusOf(payment.id)).toBe("succeeded");
  });

  it("acknowledges unknown payments and 404s unknown providers", async () => {
    const response = await deliver(
      bank.webhookRequest({ eventId: "evt_9", providerPaymentId: "fake_nope", type: "x" }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.outcome).toBe("unknown_payment");
    const unknown = await deliver(
      bank.webhookRequest({ eventId: "evt_9", providerPaymentId: "x", type: "x" }),
      "nobody",
    );
    expect(unknown.status).toBe(404);
  });

  it("refuses oversized bodies", async () => {
    const response = await deliver(
      new Request("https://spot.test/api/payments/webhooks/fake", {
        method: "POST",
        body: "x".repeat(70 * 1024),
      }),
    );
    expect(response.status).toBe(400);
  });
});
