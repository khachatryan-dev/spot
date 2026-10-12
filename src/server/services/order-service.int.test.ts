import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { restaurantStaff } from "@/server/db/schema";
import {
  diningTables,
  menuItems,
  orderItemModifiers,
  orderItems,
  orders,
  orderStatusHistory,
  restaurants,
  tableSessions,
  users,
} from "@/server/db/schema";
import { onOrderEvent, type OrderEvent } from "@/server/events/order-events";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { guest, orderingSetup, orderRequest } from "@/test/ordering-fixtures";

import {
  cancelOrderAsCustomer,
  changeOrderStatus,
  createOrder,
  getCustomerOrders,
  listKitchenOrders,
  listOrdersForStaff,
} from "./order-service";
import { resolveQrToken } from "./qr-service";
import { createRestaurant } from "./restaurant-service";
import { joinTableSession, leaveTableSession } from "./table-session-service";

beforeEach(() => truncate(db, ["restaurants", "users", "guests", "rate_limits"]));

const events: OrderEvent[] = [];
const unsubscribe = onOrderEvent((e) => {
  events.push(e);
});
afterEach(() => {
  events.length = 0;
});
void unsubscribe;

const setup = orderingSetup;
const request = orderRequest;

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).name),
  );

describe("createOrder", () => {
  it("writes the order, lines, option snapshots and first status in one go", async () => {
    const s = await setup();
    const placed = await createOrder(s.ani, s.session.id, request(s));

    expect(placed).toMatchObject({
      number: 1,
      status: "submitted",
      totalMinor: 1000000,
      currency: "AMD",
    });
    const [order] = await db.select().from(orders);
    expect(order).toMatchObject({
      tableId: s.table.id,
      tableSessionId: s.session.id,
      subtotalMinor: 1000000,
      note: "Birthday!",
    });
    expect(order?.memberId).not.toBeNull();

    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.id));
    expect(
      lines.map((l) => [
        l.name,
        l.unitPriceMinor,
        l.modifiersTotalMinor,
        l.quantity,
        l.lineTotalMinor,
        l.note,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["Pizza", 350000, 50000, 2, 800000, "well done"],
        ["Soup", 200000, 0, 1, 200000, null],
      ]),
    );
    expect(await db.select().from(orderItemModifiers)).toMatchObject([
      { groupName: "Size", name: "Large", priceDeltaMinor: 50000 },
    ]);
    expect(await db.select().from(orderStatusHistory)).toMatchObject([
      { fromStatus: null, toStatus: "submitted", changedByUserId: null },
    ]);
    expect(events).toEqual([
      expect.objectContaining({ type: "ORDER_CREATED", orderId: placed.id, number: 1 }),
    ]);
  });

  it("numbers orders per restaurant, also under concurrency", async () => {
    const s = await setup();
    const bob = await guest();
    await joinTableSession(bob, (await resolveQrToken(s.token))!);
    const placed = await Promise.all([
      createOrder(s.ani, s.session.id, request(s, "key-a-0001")),
      createOrder(bob, s.session.id, request(s, "key-b-0001")),
      createOrder(s.ani, s.session.id, request(s, "key-c-0001")),
    ]);
    expect(placed.map((p) => p.number).sort()).toEqual([1, 2, 3]);
  });

  it("returns the same order for a repeated or racing submission", async () => {
    const s = await setup();
    const first = await createOrder(s.ani, s.session.id, request(s));
    const again = await createOrder(s.ani, s.session.id, request(s));
    expect(again.id).toBe(first.id);

    const racing = await Promise.all([
      createOrder(s.ani, s.session.id, request(s, "race-key-1")),
      createOrder(s.ani, s.session.id, request(s, "race-key-1")),
    ]);
    expect(racing[0].id).toBe(racing[1].id);
    expect(await db.select().from(orders)).toHaveLength(2);
  });

  it("refuses customers who aren't at the table (outsiders, left, closed visit, suspended restaurant)", async () => {
    const s = await setup();
    const stranger = await guest();
    expect(await codeOf(createOrder(stranger, s.session.id, request(s)))).toBe("NOT_FOUND");
    expect(await codeOf(createOrder(s.ani, undefined, request(s)))).toBe("NOT_FOUND");

    await leaveTableSession(s.ani, s.session.id);
    expect(await codeOf(createOrder(s.ani, s.session.id, request(s)))).toBe("NOT_FOUND");

    await joinTableSession(s.ani, (await resolveQrToken(s.token))!);
    await db
      .update(restaurants)
      .set({ status: "suspended" })
      .where(eq(restaurants.id, s.restaurantId));
    expect(await codeOf(createOrder(s.ani, s.session.id, request(s)))).toBe("NOT_FOUND");
    await db
      .update(restaurants)
      .set({ status: "active" })
      .where(eq(restaurants.id, s.restaurantId));

    await db
      .update(tableSessions)
      .set({ status: "closed", closedAt: new Date(), closedReason: "staff" })
      .where(eq(tableSessions.id, s.session.id));
    expect(await codeOf(createOrder(s.ani, s.session.id, request(s)))).toBe("NOT_FOUND");
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("writes nothing when an item can't be ordered or the table is out of use", async () => {
    const s = await setup();
    await db.update(menuItems).set({ isAvailable: false }).where(eq(menuItems.id, s.soup.id));
    expect(await codeOf(createOrder(s.ani, s.session.id, request(s)))).toBe("ORDER_UNAVAILABLE");

    await db.update(menuItems).set({ isAvailable: true }).where(eq(menuItems.id, s.soup.id));
    await db.update(diningTables).set({ isActive: false }).where(eq(diningTables.id, s.table.id));
    expect(await codeOf(createOrder(s.ani, s.session.id, request(s)))).toBe("ORDER_UNAVAILABLE");

    expect(await db.select().from(orders)).toHaveLength(0);
    expect(await db.select().from(orderItems)).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it("charges database prices even if the request claims otherwise", async () => {
    const s = await setup();
    const tampered = {
      ...request(s),
      lines: [{ itemId: s.soup.id, quantity: 1, priceMinor: 1, lineTotalMinor: 1 }],
      totalMinor: 1,
    };
    expect((await createOrder(s.ani, s.session.id, tampered as never)).totalMinor).toBe(200000);
  });

  it("limits how many orders one visit can place in a short time", async () => {
    const s = await setup();
    for (let i = 0; i < 10; i++)
      await createOrder(s.ani, s.session.id, request(s, `spam-key-${i}`));
    expect(await codeOf(createOrder(s.ani, s.session.id, request(s, "spam-key-10")))).toBe(
      "RATE_LIMITED",
    );
  });
});

describe("getCustomerOrders", () => {
  it("shows guests their own orders, newest first, with lines and options", async () => {
    const s = await setup();
    const bob = await guest();
    await joinTableSession(bob, (await resolveQrToken(s.token))!);
    const first = await createOrder(s.ani, s.session.id, request(s, "ani-key-001"));
    const second = await createOrder(s.ani, s.session.id, request(s, "ani-key-002"));
    await createOrder(bob, s.session.id, request(s, "bob-key-001"));

    const mine = await getCustomerOrders(s.ani, s.session.id);
    expect(mine?.map((o) => o.id)).toEqual([second.id, first.id]);
    expect(mine?.[0]?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Pizza",
          quantity: 2,
          options: ["Large"],
          note: "well done",
        }),
      ]),
    );
    expect((await getCustomerOrders(bob, s.session.id))?.map((o) => o.number)).toEqual([3]);
  });

  it("returns null for people who aren't at the table", async () => {
    const s = await setup();
    await createOrder(s.ani, s.session.id, request(s));
    expect(await getCustomerOrders(await guest(), s.session.id)).toBeNull();
  });
});

describe("listOrdersForStaff", () => {
  it("lists open orders oldest first with table, lines and options — no customer details", async () => {
    const s = await setup();
    const first = await createOrder(s.ani, s.session.id, request(s, "staff-key-1"));
    const second = await createOrder(s.ani, s.session.id, request(s, "staff-key-2"));

    const open = await listOrdersForStaff(s.owner, s.restaurantId, s.locationId);
    expect(open.map((o) => o.id)).toEqual([first.id, second.id]);
    expect(open[0]).toMatchObject({
      tableNumber: "3",
      status: "submitted",
      note: "Birthday!",
      totalMinor: 1000000,
    });
    expect(open[0]?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Pizza",
          quantity: 2,
          options: ["Large"],
          note: "well done",
        }),
      ]),
    );
    expect(Object.keys(open[0]!)).not.toContain("memberId");
  });

  it("separates finished orders", async () => {
    const s = await setup();
    const done = await createOrder(s.ani, s.session.id, request(s, "staff-key-1"));
    await db.update(orders).set({ status: "completed" }).where(eq(orders.id, done.id));
    expect(await listOrdersForStaff(s.owner, s.restaurantId, s.locationId)).toEqual([]);
    expect(
      (await listOrdersForStaff(s.owner, s.restaurantId, s.locationId, { finished: true })).map(
        (o) => o.id,
      ),
    ).toEqual([done.id]);
  });

  it("lets staff with order:read see orders, isolates restaurants", async () => {
    const s = await setup();
    await createOrder(s.ani, s.session.id, request(s));
    const cook = (await db.insert(users).values({ email: "cook@example.am" }).returning())[0]!;
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: s.restaurantId, userId: cook.id, role: "kitchen" });
    expect(await listOrdersForStaff(cook, s.restaurantId, s.locationId)).toHaveLength(1);

    const outsider = (await db.insert(users).values({ email: "out@example.am" }).returning())[0]!;
    expect(await codeOf(listOrdersForStaff(outsider, s.restaurantId, s.locationId))).toBe(
      "NOT_FOUND",
    );
    const own = await createRestaurant(outsider, { name: "Own place" });
    expect(await listOrdersForStaff(outsider, own.id, s.locationId)).toEqual([]);
  });
});

describe("changeOrderStatus", () => {
  async function staff(
    restaurantId: string,
    email: string,
    role: "kitchen" | "waiter" | "cashier" | "manager",
  ) {
    const [user] = await db.insert(users).values({ email }).returning();
    await db.insert(restaurantStaff).values({ restaurantId, userId: user!.id, role });
    return user!;
  }

  it("walks the full flow with timestamps, history and events", async () => {
    const s = await setup();
    const order = await createOrder(s.ani, s.session.id, request(s));
    const cook = await staff(s.restaurantId, "cook@example.am", "kitchen");
    const waiter = await staff(s.restaurantId, "waiter@example.am", "waiter");
    events.length = 0;

    await changeOrderStatus(cook, s.restaurantId, order.id, "accepted");
    await changeOrderStatus(cook, s.restaurantId, order.id, "preparing");
    await changeOrderStatus(cook, s.restaurantId, order.id, "ready");
    await changeOrderStatus(waiter, s.restaurantId, order.id, "served");
    const done = await changeOrderStatus(waiter, s.restaurantId, order.id, "completed");

    expect(done).toMatchObject({ status: "completed" });
    expect(
      [done.acceptedAt, done.readyAt, done.servedAt, done.completedAt].every(
        (d) => d instanceof Date,
      ),
    ).toBe(true);
    const history = await db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, order.id))
      .orderBy(orderStatusHistory.changedAt);
    expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([
      [null, "submitted"],
      ["submitted", "accepted"],
      ["accepted", "preparing"],
      ["preparing", "ready"],
      ["ready", "served"],
      ["served", "completed"],
    ]);
    expect(history[1]?.changedByUserId).toBe(cook.id);
    expect(events.map((e) => (e.type === "ORDER_STATUS_CHANGED" ? e.status : e.type))).toEqual([
      "accepted",
      "preparing",
      "ready",
      "served",
      "completed",
    ]);
  });

  it("refuses steps that aren't allowed from the current status", async () => {
    const s = await setup();
    const order = await createOrder(s.ani, s.session.id, request(s));
    expect(await codeOf(changeOrderStatus(s.owner, s.restaurantId, order.id, "served"))).toBe(
      "CONFLICT",
    );
    await changeOrderStatus(s.owner, s.restaurantId, order.id, "accepted");
    expect(await codeOf(changeOrderStatus(s.owner, s.restaurantId, order.id, "submitted"))).toBe(
      "CONFLICT",
    );
    expect(
      await codeOf(changeOrderStatus(s.owner, s.restaurantId, order.id, "bogus" as never)),
    ).toBe("ZodError");
  });

  it("lets each role do only its part", async () => {
    const s = await setup();
    const order = await createOrder(s.ani, s.session.id, request(s));
    const waiter = await staff(s.restaurantId, "waiter@example.am", "waiter");
    const cook = await staff(s.restaurantId, "cook@example.am", "kitchen");
    const cashier = await staff(s.restaurantId, "cash@example.am", "cashier");

    expect(await codeOf(changeOrderStatus(waiter, s.restaurantId, order.id, "accepted"))).toBe(
      "FORBIDDEN",
    );
    expect(await codeOf(changeOrderStatus(cashier, s.restaurantId, order.id, "accepted"))).toBe(
      "FORBIDDEN",
    );
    await changeOrderStatus(cook, s.restaurantId, order.id, "accepted");
    await changeOrderStatus(cook, s.restaurantId, order.id, "ready");
    expect(await codeOf(changeOrderStatus(cook, s.restaurantId, order.id, "served"))).toBe(
      "FORBIDDEN",
    );
    expect(
      await codeOf(
        changeOrderStatus(cook, s.restaurantId, order.id, "cancelled", { reason: "nope" }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("requires a reason to reject or cancel and stores it", async () => {
    const s = await setup();
    const order = await createOrder(s.ani, s.session.id, request(s));
    expect(await codeOf(changeOrderStatus(s.owner, s.restaurantId, order.id, "rejected"))).toBe(
      "ZodError",
    );
    const rejected = await changeOrderStatus(s.owner, s.restaurantId, order.id, "rejected", {
      reason: "Kitchen is closing",
    });
    expect(rejected).toMatchObject({ status: "rejected", cancelReason: "Kitchen is closing" });
    expect(rejected.cancelledAt).toBeInstanceOf(Date);
  });

  it("lets only one of two simultaneous taps win", async () => {
    const s = await setup();
    const order = await createOrder(s.ani, s.session.id, request(s));
    const results = await Promise.all([
      codeOf(changeOrderStatus(s.owner, s.restaurantId, order.id, "accepted")),
      codeOf(changeOrderStatus(s.owner, s.restaurantId, order.id, "accepted")),
    ]);
    expect(results.sort()).toEqual(["CONFLICT", null].sort());
  });

  it("isolates restaurants", async () => {
    const s = await setup();
    const order = await createOrder(s.ani, s.session.id, request(s));
    const [other] = await db.insert(users).values({ email: "other@example.am" }).returning();
    const theirs = await createRestaurant(other!, { name: "Other place" });
    expect(await codeOf(changeOrderStatus(other!, theirs.id, order.id, "accepted"))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(changeOrderStatus(other!, s.restaurantId, order.id, "accepted"))).toBe(
      "NOT_FOUND",
    );
  });
});

describe("cancelOrderAsCustomer", () => {
  it("lets guests cancel their own order before it's accepted, not after, and not others'", async () => {
    const s = await setup();
    const bob = await guest();
    await joinTableSession(bob, (await resolveQrToken(s.token))!);
    const mine = await createOrder(s.ani, s.session.id, request(s, "mine-key-1"));
    const second = await createOrder(s.ani, s.session.id, request(s, "mine-key-2"));

    expect(await codeOf(cancelOrderAsCustomer(bob, s.session.id, mine.id))).toBe("NOT_FOUND");
    const cancelled = await cancelOrderAsCustomer(s.ani, s.session.id, mine.id);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      cancelReason: "Cancelled by the guest",
    });

    await changeOrderStatus(s.owner, s.restaurantId, second.id, "accepted");
    expect(await codeOf(cancelOrderAsCustomer(s.ani, s.session.id, second.id))).toBe("CONFLICT");
  });
});

describe("listKitchenOrders", () => {
  it("shows the queue and ready orders without any prices", async () => {
    const s = await setup();
    const first = await createOrder(s.ani, s.session.id, request(s, "kitchen-key-1"));
    const second = await createOrder(s.ani, s.session.id, request(s, "kitchen-key-2"));
    await changeOrderStatus(s.owner, s.restaurantId, second.id, "accepted");
    await changeOrderStatus(s.owner, s.restaurantId, second.id, "ready");

    const { queue, ready } = await listKitchenOrders(s.owner, s.restaurantId, s.locationId);
    expect(queue.map((o) => o.id)).toEqual([first.id]);
    expect(ready.map((o) => o.id)).toEqual([second.id]);
    expect(queue[0]).toMatchObject({ tableNumber: "3", note: "Birthday!" });
    const json = JSON.stringify({ queue, ready });
    for (const field of [
      "totalMinor",
      "currency",
      "lineTotalMinor",
      "unitPriceMinor",
      "memberId",
    ]) {
      expect(json).not.toContain(field);
    }
  });

  it("is for people who prepare orders", async () => {
    const s = await setup();
    const [waiter] = await db.insert(users).values({ email: "waiter@example.am" }).returning();
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: s.restaurantId, userId: waiter!.id, role: "waiter" });
    expect(await codeOf(listKitchenOrders(waiter!, s.restaurantId, s.locationId))).toBe(
      "FORBIDDEN",
    );
  });
});
