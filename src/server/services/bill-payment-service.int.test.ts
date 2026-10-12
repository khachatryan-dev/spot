import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  billItems,
  bills,
  payments,
  restaurantLocations,
  restaurantStaff,
  users,
} from "@/server/db/schema";
import { createFakeProvider, type FakeProvider } from "@/server/payments/fake-provider";
import { setPaymentProviderForTests } from "@/server/payments/registry";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { guest, orderingSetup, orderRequest } from "@/test/ordering-fixtures";

import { finalizeBill, getBillForStaff } from "./bill-service";
import {
  getBillPaymentState,
  recordBillPayment,
  startGuestBillPayment,
} from "./bill-payment-service";
import { changeOrderStatus, createOrder } from "./order-service";
import { syncPayment } from "./payment-service";
import { resolveQrToken } from "./qr-service";
import { joinTableSession } from "./table-session-service";

let bank: FakeProvider;
afterAll(() => setPaymentProviderForTests(undefined));
beforeEach(async () => {
  await truncate(db, ["restaurants", "users", "guests", "rate_limits", "audit_logs", "payments"]);
  bank = createFakeProvider();
  setPaymentProviderForTests(bank);
});

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

/**
 * Two guests at table 3. Ani orders 2 × large pizza (8 000 ֏), Bob a soup
 * (2 000 ֏); 10 % service → total 11 000 ֏. The bill is finalized.
 */
async function finalized() {
  const s = await orderingSetup();
  await db
    .update(restaurantLocations)
    .set({ serviceFeeBps: 1000 })
    .where(eq(restaurantLocations.id, s.locationId));
  const bob = await guest();
  await joinTableSession(bob, (await resolveQrToken(s.token))!);
  const pizza = await createOrder(s.ani, s.session.id, {
    lines: [{ itemId: s.pizza.id, modifierIds: [s.large.id], quantity: 2 }],
    idempotencyKey: "ani-order-1",
  });
  const soup = await createOrder(bob, s.session.id, {
    lines: [{ itemId: s.soup.id, quantity: 1 }],
    idempotencyKey: "bob-order-1",
  });
  for (const order of [pizza, soup]) {
    await changeOrderStatus(s.owner, s.restaurantId, order.id, "accepted");
  }
  const { bill, lines } = await finalizeBill(s.owner, s.restaurantId, s.session.id);
  const pay = (who: typeof bob, request: Parameters<typeof startGuestBillPayment>[3], now?: Date) =>
    startGuestBillPayment(who, s.session.id, bill.id, request, now);
  /** The bank answers and the guest comes back. */
  const finish = async (billPaymentId: string, outcome: "complete" | "fail" = "complete") => {
    const [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.idempotencyKey, `bill-payment:${billPaymentId}`));
    bank[outcome](row!.providerPaymentId!);
    await syncPayment(row!.id, { source: "return" });
    return row!;
  };
  const billNow = async () => (await db.select().from(bills).where(eq(bills.id, bill.id)))[0]!;
  const lineOf = (name: string) => lines.find((l) => l.name === name)!;
  return { ...s, bob, bill, lines, pay, finish, billNow, lineOf };
}

async function staff(restaurantId: string, email: string, role: "waiter" | "cashier") {
  const [user] = await db.insert(users).values({ email }).returning();
  await db.insert(restaurantStaff).values({ restaurantId, userId: user!.id, role });
  return user!;
}

describe("equal split", () => {
  it("splits the total exactly; each share is paid once; the bill is paid at the end", async () => {
    const s = await finalized();
    expect(s.bill.totalMinor).toBe(1_100_000);
    const first = await s.pay(s.ani, { mode: "equal", shareCount: 3, shareIndex: 1 });
    expect(first.redirectUrl).toContain("pay.fake.test");
    expect(await codeOf(s.pay(s.bob, { mode: "equal", shareCount: 3, shareIndex: 1 }))).toBe(
      "CONFLICT",
    );
    expect(await codeOf(s.pay(s.bob, { mode: "equal", shareCount: 2, shareIndex: 2 }))).toBe(
      "CONFLICT",
    );
    expect(await codeOf(s.pay(s.bob, { mode: "items", itemIds: [s.lineOf("Soup").id] }))).toBe(
      "CONFLICT",
    );

    await s.finish(first.billPaymentId);
    expect((await s.billNow()).paidMinor).toBe(366_600);
    for (const index of [2, 3]) {
      const { billPaymentId } = await s.pay(s.bob, {
        mode: "equal",
        shareCount: 3,
        shareIndex: index,
      });
      await s.finish(billPaymentId);
    }
    expect(await s.billNow()).toMatchObject({ status: "paid", paidMinor: 1_100_000 });
    expect(await codeOf(s.pay(s.ani, { mode: "full" }))).toBe("CONFLICT");
  });
});

describe("paying by items", () => {
  it("charges each guest their lines plus their part of the service; the last pays the exact rest", async () => {
    const s = await finalized();
    const state = await getBillPaymentState(s.bill.id);
    expect(state.remainingMinor).toBe(1_100_000);

    // Bob's soup: 2 000 ֏ + 10 % = 2 200 ֏.
    const soup = await s.pay(s.bob, { mode: "items", itemIds: [s.lineOf("Soup").id] });
    await s.finish(soup.billPaymentId);
    expect((await s.billNow()).paidMinor).toBe(220_000);

    const pizza = await s.pay(s.ani, { mode: "items", itemIds: [s.lineOf("Pizza").id] });
    await s.finish(pizza.billPaymentId);
    expect(await s.billNow()).toMatchObject({ status: "paid", paidMinor: 1_100_000 });
  });

  it("lets a guest pay for another guest's lines, or any mix", async () => {
    const s = await finalized();
    // Ani pays Bob's soup; it's recorded as Ani's payment.
    const { billPaymentId } = await s.pay(s.ani, { mode: "items", itemIds: [s.lineOf("Soup").id] });
    await s.finish(billPaymentId);
    const state = await getBillPaymentState(s.bill.id);
    expect(state.coveredItemIds).toEqual([s.lineOf("Soup").id]);
    const paidBy = state.payments.find((p) => p.id === billPaymentId)!;
    expect(paidBy.memberId).not.toBeNull();
    expect((await s.billNow()).paidMinor).toBe(220_000);
    // Bob can't pay his soup again, but can pay the pizza.
    expect(await codeOf(s.pay(s.bob, { mode: "items", itemIds: [s.lineOf("Soup").id] }))).toBe(
      "CONFLICT",
    );
    const pizza = await s.pay(s.bob, { mode: "items", itemIds: [s.lineOf("Pizza").id] });
    await s.finish(pizza.billPaymentId);
    expect((await s.billNow()).status).toBe("paid");
  });

  it("lets only one of two guests pay the same line at once", async () => {
    const s = await finalized();
    const soup = s.lineOf("Soup").id;
    const results = await Promise.all([
      codeOf(s.pay(s.ani, { mode: "items", itemIds: [soup] })),
      codeOf(s.pay(s.bob, { mode: "items", itemIds: [soup] })),
    ]);
    expect(results.sort()).toEqual(["CONFLICT", null].sort());
  });

  it("refuses lines that are not on this bill", async () => {
    const s = await finalized();
    expect(
      await codeOf(
        s.pay(s.ani, { mode: "items", itemIds: ["00000000-0000-4000-8000-000000000000"] }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("unfinished and failed online payments", () => {
  it("frees a declined payment's lines at once", async () => {
    const s = await finalized();
    const soup = s.lineOf("Soup").id;
    const attempt = await s.pay(s.bob, { mode: "items", itemIds: [soup] });
    await s.finish(attempt.billPaymentId, "fail");
    expect(await codeOf(s.pay(s.bob, { mode: "items", itemIds: [soup] }))).toBeNull();
  });

  it("frees an abandoned payment after 15 minutes, and refunds money that arrives later", async () => {
    const s = await finalized();
    const abandoned = await s.pay(s.ani, { mode: "full" });
    expect(await codeOf(s.pay(s.bob, { mode: "full" }))).toBe("CONFLICT");

    const later = new Date(Date.now() + 16 * 60_000);
    const taken = await s.pay(s.bob, { mode: "full" }, later);
    await s.finish(taken.billPaymentId);
    expect((await s.billNow()).status).toBe("paid");

    const late = await s.finish(abandoned.billPaymentId);
    const [after] = await db.select().from(payments).where(eq(payments.id, late.id));
    expect(after).toMatchObject({ status: "refunded", refundedMinor: 1_100_000 });
    expect((await s.billNow()).paidMinor).toBe(1_100_000);
  });
});

describe("settling online payments", () => {
  it("credits the bill once when the return page and webhooks arrive together", async () => {
    const s = await finalized();
    const { billPaymentId } = await s.pay(s.ani, { mode: "full" });
    const [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.idempotencyKey, `bill-payment:${billPaymentId}`));
    bank.complete(row!.providerPaymentId!);
    await Promise.all([
      syncPayment(row!.id, { source: "return" }),
      syncPayment(row!.id, { source: "webhook", providerEventId: "evt-a" }),
      syncPayment(row!.id, { source: "webhook", providerEventId: "evt-b" }),
    ]);
    expect(await s.billNow()).toMatchObject({ status: "paid", paidMinor: 1_100_000 });
  });
});

describe("staff-recorded payments", () => {
  it("lets a cashier record cash or terminal payments, but not a waiter", async () => {
    const s = await finalized();
    const waiter = await staff(s.restaurantId, "w@x.am", "waiter");
    const cashier = await staff(s.restaurantId, "c@x.am", "cashier");
    expect(
      await codeOf(
        recordBillPayment(waiter, s.restaurantId, s.bill.id, { mode: "full", method: "cash" }),
      ),
    ).toBe("FORBIDDEN");

    const soup = await recordBillPayment(cashier, s.restaurantId, s.bill.id, {
      mode: "items",
      itemIds: [s.lineOf("Soup").id],
      method: "card_terminal",
    });
    expect(soup.payment).toMatchObject({
      status: "succeeded",
      amountMinor: 220_000,
      method: "card_terminal",
    });
    const rest = await recordBillPayment(cashier, s.restaurantId, s.bill.id, {
      mode: "full",
      method: "cash",
    });
    expect(rest.payment.amountMinor).toBe(880_000);
    expect(rest.bill).toMatchObject({ status: "paid", paidMinor: 1_100_000 });
  });

  it("can't pay a bill that isn't finalized, or one from another visit", async () => {
    const s = await orderingSetup();
    await createOrder(s.ani, s.session.id, orderRequest(s));
    const { bill } = await getBillForStaff(s.owner, s.restaurantId, s.session.id);
    expect(
      await codeOf(startGuestBillPayment(s.ani, s.session.id, bill.id, { mode: "full" })),
    ).toBe("CONFLICT");
    expect(
      await codeOf(startGuestBillPayment(await guest(), s.session.id, bill.id, { mode: "full" })),
    ).toBe("NOT_FOUND");
  });

  it("never takes more than the total, even when everyone pays at once", async () => {
    const s = await finalized();
    const cashier = await staff(s.restaurantId, "c@x.am", "cashier");
    const results = await Promise.all([
      codeOf(s.pay(s.ani, { mode: "full" })),
      codeOf(s.pay(s.bob, { mode: "full" })),
      codeOf(
        recordBillPayment(cashier, s.restaurantId, s.bill.id, { mode: "full", method: "cash" }),
      ),
    ]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    const state = await getBillPaymentState(s.bill.id);
    expect(state.heldMinor).toBe(1_100_000);
    expect((await db.select().from(billItems)).length).toBe(2);
  });
});
