import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { PaymentStatus } from "@/shared/constants/payments";

import type {
  CreatePaymentInput,
  PaymentProvider,
  PaymentVerification,
  RefundPaymentInput,
  WebhookResult,
} from "./provider";

/*
 * In-memory provider for tests and local development: no money moves. Tests
 * drive it like a bank would (`complete`, `fail`), and it signs webhooks
 * with HMAC-SHA256 the way real providers do.
 */

interface FakePayment extends PaymentVerification {
  idempotencyKey: string;
  refundedMinor: number;
}

export interface FakeProvider extends PaymentProvider {
  /** The guest paid (or the bank declined) on the hosted page. */
  complete(providerPaymentId: string): void;
  fail(providerPaymentId: string, reason?: string): void;
  /** Pretend the bank's record says something else (tampering tests). */
  tamper(providerPaymentId: string, changes: Partial<PaymentVerification>): void;
  /** The next refund is declined by the bank, or the call fails mid-way (network). */
  failNextRefund(): void;
  throwNextRefund(): void;
  /** A signed webhook request, as the provider would send it. */
  webhookRequest(event: { eventId: string; providerPaymentId: string; type: string }): Request;
  readonly calls: { create: number; refund: number };
}

export function createFakeProvider(
  options: { secret?: string; payPageUrl?: string } = {},
): FakeProvider {
  const secret = options.secret ?? "fake-webhook-secret";
  const payPageUrl = options.payPageUrl ?? "https://pay.fake.test";
  const payments = new Map<string, FakePayment>();
  const byKey = new Map<string, string>();
  const refundsByKey = new Map<string, string>();
  const calls = { create: 0, refund: 0 };
  let nextRefund: "fail" | "throw" | null = null;
  const sign = (body: string) => createHmac("sha256", secret).update(body).digest("hex");

  const get = (id: string) => {
    const payment = payments.get(id);
    if (!payment) throw new Error(`Unknown fake payment ${id}`);
    return payment;
  };
  const set = (id: string, status: PaymentStatus, failureReason?: string) => {
    const payment = get(id);
    payments.set(id, { ...payment, status, failureReason });
  };

  return {
    name: "fake",
    calls,

    async createPayment(input: CreatePaymentInput) {
      calls.create++;
      const existing = byKey.get(input.idempotencyKey);
      const id = existing ?? `fake_${randomUUID()}`;
      if (!existing) {
        byKey.set(input.idempotencyKey, id);
        payments.set(id, {
          providerPaymentId: id,
          status: "pending",
          amountMinor: input.amountMinor,
          currency: input.currency,
          idempotencyKey: input.idempotencyKey,
          refundedMinor: 0,
        });
      }
      return {
        providerPaymentId: id,
        status: get(id).status,
        redirectUrl: `${payPageUrl}/${id}?return=${encodeURIComponent(input.returnUrl)}`,
      };
    },

    async verifyPayment({ providerPaymentId }) {
      const p = get(providerPaymentId);
      return {
        providerPaymentId: p.providerPaymentId,
        status: p.status,
        amountMinor: p.amountMinor,
        currency: p.currency,
        failureReason: p.failureReason,
      };
    },

    async refundPayment(input: RefundPaymentInput) {
      calls.refund++;
      const mode = nextRefund;
      nextRefund = null;
      if (mode === "throw") throw new Error("Fake provider: connection reset");
      if (mode === "fail") {
        return { providerRefundId: `fake_refund_${randomUUID()}`, status: "failed" as const };
      }
      const existing = refundsByKey.get(input.idempotencyKey);
      if (existing) return { providerRefundId: existing, status: "succeeded" };
      const payment = get(input.providerPaymentId);
      if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
        return { providerRefundId: `fake_refund_${randomUUID()}`, status: "failed" };
      }
      if (payment.refundedMinor + input.amountMinor > payment.amountMinor) {
        return { providerRefundId: `fake_refund_${randomUUID()}`, status: "failed" };
      }
      const refundedMinor = payment.refundedMinor + input.amountMinor;
      payments.set(input.providerPaymentId, {
        ...payment,
        refundedMinor,
        status: refundedMinor >= payment.amountMinor ? "refunded" : "partially_refunded",
      });
      const id = `fake_refund_${randomUUID()}`;
      refundsByKey.set(input.idempotencyKey, id);
      return { providerRefundId: id, status: "succeeded" };
    },

    async handleWebhook(request: Request): Promise<WebhookResult> {
      const body = await request.text();
      const given = Buffer.from(request.headers.get("x-fake-signature") ?? "", "hex");
      const expected = Buffer.from(sign(body), "hex");
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        throw new Error("Invalid webhook signature");
      }
      const event = JSON.parse(body) as WebhookResult;
      return {
        eventId: event.eventId,
        providerPaymentId: event.providerPaymentId,
        type: event.type,
      };
    },

    failNextRefund() {
      nextRefund = "fail";
    },
    throwNextRefund() {
      nextRefund = "throw";
    },
    complete(id) {
      set(id, "succeeded");
    },
    fail(id, reason = "declined") {
      set(id, "failed", reason);
    },
    tamper(id, changes) {
      payments.set(id, { ...get(id), ...changes });
    },
    webhookRequest(event) {
      const body = JSON.stringify(event);
      return new Request("https://spot.test/api/payments/webhooks/fake", {
        method: "POST",
        headers: { "content-type": "application/json", "x-fake-signature": sign(body) },
        body,
      });
    },
  };
}
