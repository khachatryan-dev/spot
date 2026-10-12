import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  billItems,
  billPaymentItems,
  billPayments,
  bills,
  payments,
  restaurantLocations,
  restaurantStaff,
  users,
} from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { createFakeProvider, type FakeProvider } from "@/server/payments/fake-provider";
import { setPaymentProviderForTests } from "@/server/payments/registry";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { guest, orderingSetup } from "@/test/ordering-fixtures";

import {
  type BillPaymentRequest,
  getBillPaymentState,
  recordBillPayment,
  startGuestBillPayment,
} from "./bill-payment-service";
import { finalizeBill } from "./bill-service";
import { changeOrderStatus, createOrder } from "./order-service";
import { syncPayment } from "./payment-service";
import { resolveQrToken } from "./qr-service";
import { joinTableSession } from "./table-session-service";

/*
 * Remaining-balance tests (§23 "never allow the same amount to be paid
 * twice"): seeded random sequences of mixed payments — equal shares, lines,
 * the rest; online and cash; approvals, declines, timeouts, late money and
 * concurrent payers — with the bill's invariants checked after every step.
 * A failing seed reproduces exactly.
 */

let bank: FakeProvider;
afterAll(() => setPaymentProviderForTests(undefined));
beforeEach(async () => {
  await truncate(db, ["restaurants", "users", "guests", "rate_limits", "audit_logs", "payments"]);
  bank = createFakeProvider();
  setPaymentProviderForTests(bank);
});

/** Small seeded PRNG (mulberry32): the same seed plays the same sequence. */
function random(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(list: T[]): T => list[Math.floor(next() * list.length)]!,
    chance: (p: number) => next() < p,
  };
}

/**
 * Three guests; five lines (pizzas, soups) with a 10 % service charge and
 * an awkward total, so rounding is exercised. The bill is finalized.
 */
async function table() {
  const s = await orderingSetup();
  await db
    .update(restaurantLocations)
    .set({ serviceFeeBps: 1000 })
    .where(eq(restaurantLocations.id, s.locationId));
  const others: Customer[] = [await guest(), await guest()];
  for (const g of others) await joinTableSession(g, (await resolveQrToken(s.token))!);
  const guests = [s.ani, ...others];
  const orders = [
    await createOrder(s.ani, s.session.id, {
      lines: [{ itemId: s.pizza.id, modifierIds: [s.large.id], quantity: 3 }],
      idempotencyKey: "order-ani-1",
    }),
    await createOrder(others[0]!, s.session.id, {
      lines: [{ itemId: s.soup.id, quantity: 1 }],
      idempotencyKey: "order-two-1",
    }),
    await createOrder(others[1]!, s.session.id, {
      lines: [
        { itemId: s.soup.id, quantity: 2 },
        { itemId: s.pizza.id, modifierIds: [s.large.id], quantity: 1 },
      ],
      idempotencyKey: "order-three-1",
    }),
    await createOrder(s.ani, s.session.id, {
      lines: [{ itemId: s.soup.id, quantity: 2 }],
      idempotencyKey: "order-ani-2",
    }),
  ];
  for (const o of orders) await changeOrderStatus(s.owner, s.restaurantId, o.id, "accepted");
  const { bill, lines } = await finalizeBill(s.owner, s.restaurantId, s.session.id);
  const [cashier] = await db.insert(users).values({ email: "cashier@x.am" }).returning();
  await db
    .insert(restaurantStaff)
    .values({ restaurantId: s.restaurantId, userId: cashier!.id, role: "cashier" });
  return { ...s, guests, bill, lines, cashier: cashier! };
}

type Table = Awaited<ReturnType<typeof table>>;

const swallow = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    // Refusals are expected; anything else is a bug.
    if (!(error instanceof AppError) || !["CONFLICT", "NOT_FOUND"].includes(error.code)) {
      throw error;
    }
  }
};

/** The bill's invariants, checked against the database. */
async function checkInvariants(t: Table, now: Date, label: string) {
  const state = await getBillPaymentState(t.bill.id, now); // also releases timed-out attempts
  const [bill] = await db.select().from(bills).where(eq(bills.id, t.bill.id));
  const all = await db.select().from(billPayments).where(eq(billPayments.billId, t.bill.id));
  const succeeded = all.filter((p) => p.status === "succeeded");
  const live = all.filter((p) => p.status === "pending" || p.status === "succeeded");
  const sum = (list: typeof all) => list.reduce((s, p) => s + p.amountMinor, 0);

  // Money taken is exactly what the bill records, and never more than the total.
  expect(bill!.paidMinor, label).toBe(sum(succeeded));
  expect(bill!.paidMinor, label).toBeLessThanOrEqual(bill!.totalMinor);
  // Reserved plus paid never exceeds the total either.
  expect(sum(live), label).toBeLessThanOrEqual(bill!.totalMinor);
  expect(state.remainingMinor, label).toBe(bill!.totalMinor - sum(live));
  // Paid exactly when fully paid.
  expect(bill!.status === "paid", label).toBe(bill!.paidMinor === bill!.totalMinor);

  // No share and no line held twice.
  const shares = live.filter((p) => p.shareIndex !== null).map((p) => p.shareIndex);
  expect(new Set(shares).size, label).toBe(shares.length);
  const counts = new Set(live.filter((p) => p.mode === "equal").map((p) => p.shareCount));
  expect(counts.size, label).toBeLessThanOrEqual(1);
  const heldLines = await db
    .select({ billItemId: billPaymentItems.billItemId })
    .from(billPaymentItems)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentItems.billPaymentId))
    .where(
      and(
        eq(billPayments.billId, t.bill.id),
        inArray(billPayments.status, ["pending", "succeeded"]),
      ),
    );
  expect(new Set(heldLines.map((l) => l.billItemId)).size, label).toBe(heldLines.length);
  // Equal shares and lines are never mixed.
  expect(live.some((p) => p.mode === "equal") && live.some((p) => p.mode === "items"), label).toBe(
    false,
  );

  // Every online success is backed by a provider success; money taken for
  // a payment that didn't count has been (or is being) given back.
  const linked = all.filter((p) => p.paymentId);
  if (linked.length > 0) {
    const providerRows = await db
      .select()
      .from(payments)
      .where(
        inArray(
          payments.id,
          linked.map((p) => p.paymentId!),
        ),
      );
    for (const p of linked) {
      const provider = providerRows.find((r) => r.id === p.paymentId)!;
      if (p.status === "succeeded") expect(provider.status, label).toBe("succeeded");
      if (p.status !== "succeeded" && p.status !== "pending") {
        expect(["pending", "failed", "refunded", "cancelled"], label).toContain(provider.status);
      }
    }
  }
}

/** What the random runs actually did, so a passing run can't be an idle one. */
const seen = new Map<string, number>();
const count = (key: string, n = 1) => seen.set(key, (seen.get(key) ?? 0) + n);

async function play(seed: number, steps: number) {
  const t = await table();
  const r = random(seed);
  let now = new Date();
  const lineIds = t.lines.map((l) => l.id);

  const request = (): BillPaymentRequest => {
    const kind = r.pick(["equal", "items", "full"] as const);
    if (kind === "equal") {
      const count = r.pick([2, 3, 4]);
      return { mode: "equal", shareCount: count, shareIndex: 1 + r.int(count) };
    }
    if (kind === "items") {
      const chosen = lineIds.filter(() => r.chance(0.4));
      return { mode: "items", itemIds: chosen.length > 0 ? chosen : [r.pick(lineIds)] };
    }
    return { mode: "full" };
  };
  const guestPays = (at: Date) =>
    swallow(startGuestBillPayment(r.pick(t.guests), t.session.id, t.bill.id, request(), at));
  const cashierTakes = (at: Date) =>
    swallow(
      recordBillPayment(
        t.cashier,
        t.restaurantId,
        t.bill.id,
        {
          ...request(),
          method: r.pick(["cash", "card_terminal"] as const),
        },
        at,
      ),
    );
  /** The bank answers one open online payment (possibly one that already timed out). */
  const bankAnswers = async () => {
    const open = await db
      .select({ payment: payments })
      .from(billPayments)
      .innerJoin(payments, eq(payments.id, billPayments.paymentId))
      .where(and(eq(billPayments.billId, t.bill.id), eq(payments.status, "pending")));
    if (open.length === 0) return;
    const { payment } = r.pick(open);
    if (r.chance(0.7)) bank.complete(payment.providerPaymentId!);
    else bank.fail(payment.providerPaymentId!);
    await syncPayment(payment.id, { source: r.pick(["return", "webhook"] as const) });
  };

  for (let step = 0; step < steps; step++) {
    const action = r.int(10);
    if (action < 4) await guestPays(now);
    else if (action < 6) await bankAnswers();
    else if (action < 7) await cashierTakes(now);
    else if (action < 8)
      now = new Date(now.getTime() + 16 * 60_000); // abandoned attempts time out
    else await Promise.all([guestPays(now), guestPays(now), cashierTakes(now)]); // a rush
    await checkInvariants(t, now, `seed ${seed}, step ${step}`);
  }

  // Wind down: the bank answers everything still open, then the cashier
  // takes whatever is left. The bill must end exactly paid.
  for (let i = 0; i < 20; i++) await bankAnswers();
  const state = await getBillPaymentState(t.bill.id, new Date(now.getTime() + 16 * 60_000));
  if (state.remainingMinor > 0) {
    await recordBillPayment(
      t.cashier,
      t.restaurantId,
      t.bill.id,
      { mode: "full", method: "cash" },
      new Date(now.getTime() + 16 * 60_000),
    );
  }
  await checkInvariants(t, new Date(now.getTime() + 17 * 60_000), `seed ${seed}, end`);
  const [bill] = await db.select().from(bills).where(eq(bills.id, t.bill.id));
  expect(bill).toMatchObject({ status: "paid", paidMinor: bill!.totalMinor });

  const done = await db.select().from(billPayments).where(eq(billPayments.billId, t.bill.id));
  for (const p of done) {
    count(`status:${p.status}`);
    if (p.status === "succeeded")
      count(`paid:${p.mode}:${p.method === "online" ? "online" : "staff"}`);
  }

  // Money that arrived for a claim given up was refunded in full.
  const late = await db
    .select({ provider: payments, status: billPayments.status })
    .from(billPayments)
    .innerJoin(payments, eq(payments.id, billPayments.paymentId))
    .where(eq(billPayments.billId, t.bill.id));
  for (const { provider, status } of late) {
    if (status !== "succeeded" && provider.status !== "failed" && provider.status !== "pending") {
      expect(provider, `seed ${seed}: late money`).toMatchObject({
        status: "refunded",
        refundedMinor: provider.amountMinor,
      });
      count("late money refunded");
    }
  }
  return bill!;
}

describe("remaining balance under mixed payments", () => {
  it("has an awkward total, so rounding matters", async () => {
    const t = await table();
    const lines = await db.select().from(billItems).where(eq(billItems.billId, t.bill.id));
    expect(lines).toHaveLength(5);
    // 26 000 ֏ + 10 % = 28 600 ֏: not a whole number of dram three ways.
    expect(t.bill.totalMinor).toBe(2_860_000);
    expect(t.bill.totalMinor % 300).not.toBe(0);
  });

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    it(`keeps every invariant (seed ${seed})`, async () => {
      await play(seed, 30);
    });
  }

  it("exercised every kind of payment along the way", () => {
    for (const key of [
      "paid:equal:online",
      "paid:items:online",
      "paid:full:online",
      "paid:equal:staff",
      "paid:items:staff",
      "paid:full:staff",
      "status:failed",
      "status:expired",
      "late money refunded",
    ]) {
      expect(seen.get(key) ?? 0, key).toBeGreaterThan(0);
    }
  });
});
