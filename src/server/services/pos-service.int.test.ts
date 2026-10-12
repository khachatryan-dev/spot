import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  menuItems,
  posConnections,
  posExternalRefs,
  posOutbox,
  restaurantStaff,
  users,
} from "@/server/db/schema";
import { createFakePos, type FakePos } from "@/server/pos/fake-pos";
import { setPosProviderForTests } from "@/server/pos/registry";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { orderingSetup, orderRequest } from "@/test/ordering-fixtures";

import { finalizeBill } from "./bill-service";
import { recordBillPayment } from "./bill-payment-service";
import { changeOrderStatus, createOrder } from "./order-service";
import {
  connectPos,
  deliverPosOutbox,
  disconnectPos,
  linkPosCatalog,
  listPosConnections,
  retryFailedPosItems,
  syncPosStock,
} from "./pos-service";

let pos: FakePos;

beforeEach(async () => {
  await truncate(db, ["restaurants", "users", "guests", "rate_limits", "audit_logs"]);
  pos = createFakePos();
  setPosProviderForTests(pos);
});
afterAll(() => setPosProviderForTests(undefined, "fake"));

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

const minutes = (n: number, from = new Date()) => new Date(from.getTime() + n * 60_000);

async function connected() {
  const s = await orderingSetup();
  const connection = await connectPos(s.owner, s.restaurantId, {
    locationId: s.locationId,
    provider: "fake",
  });
  return { ...s, connection };
}

const outbox = (connectionId: string) =>
  db.select().from(posOutbox).where(eq(posOutbox.connectionId, connectionId));

describe("POS connections", () => {
  it("connects one live POS per location, for managers only", async () => {
    const s = await connected();
    expect(s.connection).toMatchObject({ provider: "fake", status: "active" });
    expect(
      await codeOf(
        connectPos(s.owner, s.restaurantId, { locationId: s.locationId, provider: "fake" }),
      ),
    ).toBe("CONFLICT");
    expect(
      await codeOf(
        connectPos(s.owner, s.restaurantId, { locationId: s.locationId, provider: "iiko" }),
      ),
    ).toBe("RESOURCE_UNAVAILABLE");
    expect(
      await codeOf(
        connectPos(s.owner, s.restaurantId, { locationId: s.restaurantId, provider: "fake" }),
      ),
    ).toBe("NOT_FOUND");

    const [waiter] = await db.insert(users).values({ email: "w@x.am" }).returning();
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: s.restaurantId, userId: waiter!.id, role: "waiter" });
    expect(await codeOf(listPosConnections(waiter!, s.restaurantId))).toBe("FORBIDDEN");

    const { connections, providers } = await listPosConnections(s.owner, s.restaurantId);
    expect(providers).toContain("fake");
    expect(connections).toEqual([
      expect.objectContaining({ locationName: "Main", pending: 0, failed: 0 }),
    ]);

    // Disconnecting frees the location for a new connection.
    await disconnectPos(s.owner, s.restaurantId, s.connection.id);
    await connectPos(s.owner, s.restaurantId, { locationId: s.locationId, provider: "fake" });
  });

  it("queues nothing for locations without a POS", async () => {
    const s = await orderingSetup();
    await createOrder(s.ani, s.session.id, orderRequest(s));
    expect(await db.select().from(posOutbox)).toEqual([]);
    expect(await deliverPosOutbox()).toEqual({ sent: 0, retrying: 0, failed: 0 });
  });
});

describe("sending orders to the POS", () => {
  it("sends new orders and status changes in order, with linked dishes and tables", async () => {
    const s = await connected();
    pos.menu = [
      { externalId: "p-1", name: "pizza ", priceMinor: 350000 },
      { externalId: "p-9", name: "Khinkali", priceMinor: 100000 },
    ];
    pos.tables = [{ externalId: "t-3", number: "3" }];
    expect(await linkPosCatalog(s.owner, s.restaurantId, s.connection.id)).toEqual({
      items: { linked: 1, unmatched: ["Khinkali"] },
      tables: { linked: 1, unmatched: [] },
    });

    const order = await createOrder(s.ani, s.session.id, orderRequest(s));
    await changeOrderStatus(s.owner, s.restaurantId, order.id, "accepted");
    expect(await deliverPosOutbox()).toEqual({ sent: 2, retrying: 0, failed: 0 });

    const [sent] = [...pos.orders.values()];
    expect(sent).toMatchObject({
      orderId: order.id,
      tableNumber: "3",
      externalTableId: "t-3",
      totalMinor: order.totalMinor,
      note: "Birthday!",
      status: "accepted",
    });
    expect(sent!.lines).toHaveLength(2);
    expect(sent!.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalItemId: "p-1",
          name: "Pizza",
          quantity: 2,
          options: ["Large"],
          note: "well done",
        }),
        expect.objectContaining({ externalItemId: null, name: "Soup", quantity: 1 }),
      ]),
    );
    const refs = await db
      .select()
      .from(posExternalRefs)
      .where(eq(posExternalRefs.entityType, "order"));
    expect(refs).toEqual([expect.objectContaining({ localId: order.id })]);
    expect((await outbox(s.connection.id)).every((i) => i.status === "sent")).toBe(true);

    // Nothing left to do: a second run sends nothing.
    expect(await deliverPosOutbox()).toEqual({ sent: 0, retrying: 0, failed: 0 });
  });

  it("retries an offline POS with backoff, holding later changes until the order is in", async () => {
    const s = await connected();
    const order = await createOrder(s.ani, s.session.id, orderRequest(s));
    await changeOrderStatus(s.owner, s.restaurantId, order.id, "accepted");
    const now = new Date();

    pos.failNext(1);
    expect(await deliverPosOutbox({}, now)).toEqual({ sent: 0, retrying: 1, failed: 0 });
    const [first] = (await outbox(s.connection.id)).filter((i) => i.kind === "order_created");
    expect(first).toMatchObject({ status: "pending", attempts: 1, lastError: "POS is offline" });
    const [connection] = await db
      .select()
      .from(posConnections)
      .where(eq(posConnections.id, s.connection.id));
    expect(connection!.lastError).toBe("POS is offline");

    // Still waiting: neither the order nor its status change goes out.
    expect(await deliverPosOutbox({}, minutes(0.5, now))).toEqual({
      sent: 0,
      retrying: 0,
      failed: 0,
    });
    expect(pos.calls.updateOrder).toBe(0);

    expect(await deliverPosOutbox({}, minutes(2, now))).toEqual({
      sent: 2,
      retrying: 0,
      failed: 0,
    });
    expect([...pos.orders.values()].map((o) => o.status)).toEqual(["accepted"]);
    const [after] = await db
      .select()
      .from(posConnections)
      .where(eq(posConnections.id, s.connection.id));
    expect(after).toMatchObject({ lastError: null, deliveryLeaseUntil: null });
  });

  it("gives up on rejected changes without blocking the rest, and can retry them", async () => {
    const s = await connected();
    const first = await createOrder(s.ani, s.session.id, orderRequest(s, "pos-order-1"));
    await changeOrderStatus(s.owner, s.restaurantId, first.id, "accepted");
    const second = await createOrder(s.ani, s.session.id, orderRequest(s, "pos-order-2"));

    pos.failNext(1, "reject");
    // The first order is refused; its status change can't go without it; the second goes.
    expect(await deliverPosOutbox()).toEqual({ sent: 1, retrying: 0, failed: 2 });
    expect([...pos.orders.values()].map((o) => o.orderId)).toEqual([second.id]);
    const failed = (await outbox(s.connection.id)).filter((i) => i.status === "failed");
    expect(failed.map((i) => i.lastError).sort()).toEqual([
      "Rejected by the POS",
      "The order never reached the POS.",
    ]);
    expect((await listPosConnections(s.owner, s.restaurantId)).connections[0]).toMatchObject({
      pending: 0,
      failed: 2,
    });

    expect(await retryFailedPosItems(s.owner, s.restaurantId, s.connection.id)).toBe(2);
    expect(await deliverPosOutbox()).toEqual({ sent: 2, retrying: 0, failed: 0 });
    expect(pos.orders.size).toBe(2);
  });

  it("marks a change failed after the last retry", async () => {
    const s = await connected();
    await createOrder(s.ani, s.session.id, orderRequest(s));
    pos.failNext(100);
    let now = new Date();
    for (let attempt = 0; attempt < 6; attempt++) {
      await deliverPosOutbox({}, now);
      now = minutes(24 * 60, now);
    }
    const [item] = await outbox(s.connection.id);
    expect(item).toMatchObject({ status: "failed", attempts: 6 });
  });

  it("sends each change once when two runs overlap", async () => {
    const s = await connected();
    await createOrder(s.ani, s.session.id, orderRequest(s));
    const runs = await Promise.all([deliverPosOutbox(), deliverPosOutbox(), deliverPosOutbox()]);
    expect(runs.reduce((sum, r) => sum + r.sent, 0)).toBe(1);
    expect(pos.calls.createOrder).toBe(1);
  });

  it("stops queueing once the POS is disconnected", async () => {
    const s = await connected();
    await createOrder(s.ani, s.session.id, orderRequest(s, "pos-order-1"));
    await disconnectPos(s.owner, s.restaurantId, s.connection.id);
    await createOrder(s.ani, s.session.id, orderRequest(s, "pos-order-2"));
    expect(await outbox(s.connection.id)).toHaveLength(1);
    expect(await deliverPosOutbox()).toEqual({ sent: 0, retrying: 0, failed: 0 });
  });

  it("closes the check in the POS when the bill is paid", async () => {
    const s = await connected();
    const order = await createOrder(s.ani, s.session.id, orderRequest(s));
    await changeOrderStatus(s.owner, s.restaurantId, order.id, "accepted");
    const { bill } = await finalizeBill(s.owner, s.restaurantId, s.session.id);
    await recordBillPayment(s.owner, s.restaurantId, bill.id, { mode: "full", method: "cash" });

    expect(await deliverPosOutbox()).toEqual({ sent: 3, retrying: 0, failed: 0 });
    expect(pos.closedBills).toEqual([
      expect.objectContaining({
        billId: bill.id,
        totalMinor: bill.totalMinor,
        paidMinor: bill.totalMinor,
        externalOrderIds: [[...pos.orders.keys()][0]],
      }),
    ]);
    expect([...pos.orders.values()][0]!.closed).toBe(true);
  });
});

describe("POS catalog and stock", () => {
  it("leaves ambiguous names unlinked and replaces links on each run", async () => {
    const s = await connected();
    pos.menu = [
      { externalId: "a", name: "Soup", priceMinor: 1 },
      { externalId: "b", name: "soup", priceMinor: 1 },
      { externalId: "c", name: "Pizza", priceMinor: 1 },
    ];
    pos.tables = [{ externalId: "t", number: "7" }];
    expect(await linkPosCatalog(s.owner, s.restaurantId, s.connection.id)).toEqual({
      items: { linked: 1, unmatched: ["Soup", "soup"] },
      tables: { linked: 0, unmatched: ["7"] },
    });
    pos.menu = [{ externalId: "d", name: "Soup", priceMinor: 1 }];
    await linkPosCatalog(s.owner, s.restaurantId, s.connection.id);
    const links = await db
      .select({ localId: posExternalRefs.localId, externalId: posExternalRefs.externalId })
      .from(posExternalRefs)
      .where(eq(posExternalRefs.connectionId, s.connection.id));
    expect(links).toEqual([{ localId: s.soup.id, externalId: "d" }]);

    pos.failNext(1);
    expect(await codeOf(linkPosCatalog(s.owner, s.restaurantId, s.connection.id))).toBe(
      "RESOURCE_UNAVAILABLE",
    );
  });

  it("follows the POS's stock for linked dishes", async () => {
    const s = await connected();
    pos.menu = [
      { externalId: "p", name: "Pizza", priceMinor: 1 },
      { externalId: "s", name: "Soup", priceMinor: 1 },
    ];
    await linkPosCatalog(s.owner, s.restaurantId, s.connection.id);
    const available = async () =>
      Object.fromEntries(
        (
          await db
            .select({ name: menuItems.name, isAvailable: menuItems.isAvailable })
            .from(menuItems)
            .where(eq(menuItems.restaurantId, s.restaurantId))
        ).map((i) => [i.name, i.isAvailable]),
      );

    pos.stock = [{ externalId: "p", available: 0 }];
    expect(await syncPosStock()).toEqual({ changed: 1 });
    expect(await available()).toEqual({ Pizza: false, Soup: true });
    expect(await syncPosStock()).toEqual({ changed: 0 });

    pos.stock = [
      { externalId: "p", available: 4 },
      { externalId: "s", available: 0 },
    ];
    expect(await syncPosStock()).toEqual({ changed: 2 });
    expect(await available()).toEqual({ Pizza: true, Soup: false });

    // A POS that doesn't answer changes nothing.
    pos.failNext(1);
    expect(await syncPosStock()).toEqual({ changed: 0 });
    const [connection] = await db
      .select()
      .from(posConnections)
      .where(eq(posConnections.id, s.connection.id));
    expect(connection!.lastError).toBe("POS is offline");
  });
});
