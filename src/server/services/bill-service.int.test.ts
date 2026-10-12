import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  auditLogs,
  bills,
  restaurantLocations,
  restaurants,
  restaurantStaff,
  users,
} from "@/server/db/schema";
import { type RealtimeHint } from "@/server/realtime/channels";
import { setRealtimePublisherForTests } from "@/server/realtime/realtime";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { guest, orderingSetup, orderRequest } from "@/test/ordering-fixtures";

import { finalizeBill, getBillForGuest, getBillForStaff, voidBill } from "./bill-service";
import { cancelOrderAsCustomer, changeOrderStatus, createOrder } from "./order-service";

const sent: { channel: string; hint: RealtimeHint }[] = [];
setRealtimePublisherForTests({
  publish: async (channel, hint) => void sent.push({ channel, hint }),
});
afterAll(() => setRealtimePublisherForTests(undefined));
beforeEach(async () => {
  await truncate(db, ["restaurants", "users", "guests", "rate_limits", "audit_logs"]);
  sent.length = 0;
});

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

/** A visit with one order: 2 × large pizza (4 000 ֏) + soup (2 000 ֏) = 10 000 ֏. */
async function ordered() {
  const s = await orderingSetup();
  const order = await createOrder(s.ani, s.session.id, orderRequest(s));
  const accept = (id: string) => changeOrderStatus(s.owner, s.restaurantId, id, "accepted");
  const staffBill = () => getBillForStaff(s.owner, s.restaurantId, s.session.id);
  return { ...s, order, accept, staffBill };
}

async function staff(restaurantId: string, email: string, role: "waiter" | "cashier") {
  const [user] = await db.insert(users).values({ email }).returning();
  await db.insert(restaurantStaff).values({ restaurantId, userId: user!.id, role });
  return user!;
}

describe("the open bill", () => {
  it("follows the visit's orders, with option snapshots and who ordered what", async () => {
    const { staffBill } = await ordered();
    const { bill, lines, tableNumber } = await staffBill();
    expect(bill).toMatchObject({ status: "open", subtotalMinor: 1_000_000, totalMinor: 1_000_000 });
    expect(tableNumber).toBe("3");
    expect(lines.map((l) => [l.name, l.quantity, l.lineTotalMinor])).toEqual([
      ["Pizza", 2, 800_000],
      ["Soup", 1, 200_000],
    ]);
    expect(lines[0]!.options).toEqual([{ group: "Size", name: "Large", priceDeltaMinor: 50_000 }]);
    expect(lines[0]!.memberId).toBeTruthy();
  });

  it("drops cancelled orders and picks up new ones", async () => {
    const s = await ordered();
    await cancelOrderAsCustomer(s.ani, s.session.id, s.order.id);
    expect((await s.staffBill()).lines).toHaveLength(0);
    await createOrder(s.ani, s.session.id, orderRequest(s, "checkout-0002"));
    expect((await s.staffBill()).bill.subtotalMinor).toBe(1_000_000);
  });

  it("adds the location's service charge and shows the VAT inside the total", async () => {
    const s = await ordered();
    await db
      .update(restaurantLocations)
      .set({ serviceFeeBps: 1000 })
      .where(eq(restaurantLocations.id, s.locationId));
    await db
      .update(restaurants)
      .set({ vatRateBps: 2000 })
      .where(eq(restaurants.id, s.restaurantId));
    expect((await s.staffBill()).bill).toMatchObject({
      subtotalMinor: 1_000_000,
      serviceFeeBps: 1000,
      serviceFeeMinor: 100_000,
      totalMinor: 1_100_000,
      vatRateBps: 2000,
      taxIncludedMinor: 183_300, // 11 000 ÷ 6, rounded to whole dram
    });
  });

  it("is shown to guests at the table only", async () => {
    const s = await ordered();
    expect((await getBillForGuest(s.ani, s.session.id))?.bill.totalMinor).toBe(1_000_000);
    expect(await getBillForGuest(await guest(), s.session.id)).toBeNull();
  });
});

describe("finalizeBill", () => {
  it("waits for the kitchen, then locks the bill and stops further orders", async () => {
    const s = await ordered();
    expect(await codeOf(finalizeBill(s.owner, s.restaurantId, s.session.id))).toBe("CONFLICT");
    await s.accept(s.order.id);
    const { bill } = await finalizeBill(s.owner, s.restaurantId, s.session.id);
    expect(bill).toMatchObject({
      status: "finalized",
      totalMinor: 1_000_000,
      finalizedByUserId: s.owner.id,
    });
    expect(await codeOf(createOrder(s.ani, s.session.id, orderRequest(s, "checkout-0003")))).toBe(
      "ORDER_UNAVAILABLE",
    );
    expect(await codeOf(finalizeBill(s.owner, s.restaurantId, s.session.id))).toBe("CONFLICT");
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "bill.finalized"));
    expect(audit).toMatchObject({ entityId: bill.id, metadata: { totalMinor: 1_000_000 } });
    expect(sent.map((m) => m.hint.type)).toContain("BILL_CHANGED");
  });

  it("keeps a finalized bill fixed even if the menu or rates change", async () => {
    const s = await ordered();
    await s.accept(s.order.id);
    await finalizeBill(s.owner, s.restaurantId, s.session.id);
    await db
      .update(restaurantLocations)
      .set({ serviceFeeBps: 1500 })
      .where(eq(restaurantLocations.id, s.locationId));
    expect((await s.staffBill()).bill).toMatchObject({ totalMinor: 1_000_000, serviceFeeMinor: 0 });
  });

  it("refuses an empty bill, waiters, and other restaurants", async () => {
    const s = await orderingSetup();
    expect(await codeOf(finalizeBill(s.owner, s.restaurantId, s.session.id))).toBe("CONFLICT");
    const waiter = await staff(s.restaurantId, "w@x.am", "waiter");
    expect(await codeOf(finalizeBill(waiter, s.restaurantId, s.session.id))).toBe("FORBIDDEN");
    expect((await getBillForStaff(waiter, s.restaurantId, s.session.id)).lines).toEqual([]);
    const cashier = await staff(s.restaurantId, "c@x.am", "cashier");
    expect(await codeOf(getBillForStaff(cashier, s.restaurantId, s.restaurantId))).toBe(
      "NOT_FOUND",
    );
  });

  it("never loses an order placed while the bill is being finalized", async () => {
    const s = await ordered();
    await s.accept(s.order.id);
    const [order, finalize] = await Promise.all([
      codeOf(createOrder(s.ani, s.session.id, orderRequest(s, "checkout-race1"))),
      codeOf(finalizeBill(s.owner, s.restaurantId, s.session.id)),
    ]);
    // Either the order came first (and the kitchen must answer before finalizing),
    // or the bill was finalized first (and the order is refused).
    expect([order, finalize].sort()).toEqual(
      order === null ? ["CONFLICT", null].sort() : ["ORDER_UNAVAILABLE", null].sort(),
    );
  });
});

describe("voidBill", () => {
  it("cancels an unpaid bill with a reason; the visit gets a fresh one", async () => {
    const s = await ordered();
    await s.accept(s.order.id);
    const { bill } = await finalizeBill(s.owner, s.restaurantId, s.session.id);
    expect(await codeOf(voidBill(s.owner, s.restaurantId, bill.id, ""))).toContain(
      "reasonTooShort",
    );
    const voided = await voidBill(s.owner, s.restaurantId, bill.id, "Wrong items, redo");
    expect(voided).toMatchObject({ status: "void", voidReason: "Wrong items, redo" });

    const fresh = await s.staffBill();
    expect(fresh.bill.id).not.toBe(bill.id);
    expect(fresh.bill).toMatchObject({ status: "open", subtotalMinor: 1_000_000 });
    await createOrder(s.ani, s.session.id, orderRequest(s, "checkout-0004"));
  });

  it("refuses bills with payments, and other roles", async () => {
    const s = await ordered();
    await s.accept(s.order.id);
    const { bill } = await finalizeBill(s.owner, s.restaurantId, s.session.id);
    const waiter = await staff(s.restaurantId, "w@x.am", "waiter");
    expect(await codeOf(voidBill(waiter, s.restaurantId, bill.id, "No reason"))).toBe("FORBIDDEN");
    await db.update(bills).set({ paidMinor: 100_000 }).where(eq(bills.id, bill.id));
    expect(await codeOf(voidBill(s.owner, s.restaurantId, bill.id, "Too late now"))).toBe(
      "CONFLICT",
    );
  });
});
