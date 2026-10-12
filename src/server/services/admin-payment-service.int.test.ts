import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { restaurants, restaurantStaff, users } from "@/server/db/schema";
import { createFakeProvider, type FakeProvider } from "@/server/payments/fake-provider";
import { setPaymentProviderForTests } from "@/server/payments/registry";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import {
  getPaymentDetail,
  listPaymentProblems,
  listPayments,
  paymentFilterSchema,
  paymentTotals,
} from "./admin-payment-service";
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
async function scene() {
  const [admin] = await db
    .insert(users)
    .values({ email: "admin@x.am", platformRole: "platform_admin" })
    .returning();
  const [owner] = await db.insert(users).values({ email: "owner@x.am" }).returning();
  const [cafe] = await db
    .insert(restaurants)
    .values({ name: "Cafe", slug: "cafe", status: "active" })
    .returning();
  const [bistro] = await db
    .insert(restaurants)
    .values({ name: "Bistro", slug: "bistro", status: "active" })
    .returning();
  await db
    .insert(restaurantStaff)
    .values({ restaurantId: cafe!.id, userId: owner!.id, role: "owner" });
  const pay = async (restaurantId: string, amountMinor: number, outcome?: "complete" | "fail") => {
    const { payment } = await startPayment({
      restaurantId,
      purpose: "bill",
      customerUserId: null,
      amountMinor,
      currency: "AMD",
      description: "Bill",
      returnUrl: "https://spot.test/return",
      idempotencyKey: `monitor-bill-${++keys}`,
    });
    if (outcome) {
      bank[outcome](payment.providerPaymentId!);
      await syncPayment(payment.id, { source: "return" });
    }
    return payment;
  };
  return { admin: admin!, owner: owner!, cafe: cafe!, bistro: bistro!, pay };
}

const all = paymentFilterSchema.parse({});

describe("payment monitoring", () => {
  it("lists payments with filters, and totals per currency", async () => {
    const s = await scene();
    const paid = await s.pay(s.cafe.id, 1_000_000, "complete");
    await s.pay(s.cafe.id, 300_000, "fail");
    await s.pay(s.bistro.id, 500_000); // pending
    await refundPayment(s.owner, s.cafe.id, paid.id, {
      amountMinor: 200_000,
      reason: "Cold soup",
      idempotencyKey: "refund-monitor-1",
    });

    expect((await listPayments(s.admin, all)).map((p) => [p.restaurantName, p.status])).toEqual([
      ["Bistro", "pending"],
      ["Cafe", "failed"],
      ["Cafe", "partially_refunded"],
    ]);
    expect(
      await listPayments(s.admin, paymentFilterSchema.parse({ status: "failed" })),
    ).toHaveLength(1);
    expect(
      await listPayments(s.admin, paymentFilterSchema.parse({ restaurant: s.bistro.id })),
    ).toHaveLength(1);
    expect(await paymentTotals(s.admin, all)).toEqual([
      {
        currency: "AMD",
        paidMinor: 1_000_000,
        refundedMinor: 200_000,
        paidCount: 1,
        failedCount: 1,
        pendingCount: 1,
      },
    ]);
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect(await listPayments(s.admin, paymentFilterSchema.parse({ from: tomorrow }))).toEqual([]);
  });

  it("flags mismatches, failed refunds and payments stuck without an answer", async () => {
    const s = await scene();
    const tampered = await s.pay(s.cafe.id, 400_000);
    bank.tamper(tampered.providerPaymentId!, { status: "succeeded", amountMinor: 100 });
    await syncPayment(tampered.id, { source: "webhook" });
    const paid = await s.pay(s.cafe.id, 600_000, "complete");
    bank.failNextRefund();
    await refundPayment(s.owner, s.cafe.id, paid.id, {
      amountMinor: 600_000,
      reason: "Wrong table",
      idempotencyKey: "refund-monitor-2",
    });
    const stuck = await s.pay(s.bistro.id, 250_000);

    const now = new Date(Date.now() + 2 * 60 * 60_000);
    const problems = await listPaymentProblems(s.admin, now);
    expect(problems.map((p) => [p.kind, p.paymentId])).toEqual(
      expect.arrayContaining([
        ["amount_mismatch", tampered.id],
        ["refund_failed", paid.id],
        ["payment_stuck", stuck.id],
      ]),
    );
    expect(problems).toHaveLength(3);
    // An hour earlier, the pending payment isn't stuck yet.
    expect((await listPaymentProblems(s.admin)).map((p) => p.kind)).not.toContain("payment_stuck");
  });

  it("shows a payment's full history and refunds", async () => {
    const s = await scene();
    const paid = await s.pay(s.cafe.id, 1_000_000, "complete");
    await refundPayment(s.owner, s.cafe.id, paid.id, {
      amountMinor: 1_000_000,
      reason: "Event cancelled",
      idempotencyKey: "refund-monitor-3",
    });
    const detail = await getPaymentDetail(s.admin, paid.id);
    expect(detail.payment).toMatchObject({ status: "refunded", restaurantName: "Cafe" });
    expect(detail.events.map((e) => e.type)).toEqual([
      "created",
      "status_changed",
      "refund_requested",
      "refunded",
    ]);
    expect(detail.refunds).toMatchObject([{ status: "succeeded", reason: "Event cancelled" }]);
    expect(detail.billId).toBeNull();
  });

  it("is for platform admins only", async () => {
    const s = await scene();
    const paid = await s.pay(s.cafe.id, 1_000, "complete");
    expect(await codeOf(listPayments(s.owner, all))).toBe("FORBIDDEN");
    expect(await codeOf(getPaymentDetail(s.owner, paid.id))).toBe("FORBIDDEN");
    expect(await codeOf(getPaymentDetail(s.admin, "nope"))).toBe("NOT_FOUND");
  });
});
