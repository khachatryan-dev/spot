import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { menuItems, posConnections, posExternalRefs, posOutbox } from "@/server/db/schema";
import { createOneCHttpProvider } from "@/server/pos/onec/onec-http-provider";
import { setPosProviderForTests } from "@/server/pos/registry";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { createFakeOneC } from "@/test/fake-onec";
import { orderingSetup, orderRequest } from "@/test/ordering-fixtures";

import { changeOrderStatus, createOrder } from "./order-service";
import {
  acknowledgeChanges,
  authenticateExchange,
  pullChanges,
  receiveCatalog,
  receiveStock,
} from "./pos-exchange-service";
import {
  connectPos,
  deliverPosOutbox,
  disconnectPos,
  linkPosCatalog,
  rotateExchangeToken,
  syncPosStock,
} from "./pos-service";

beforeEach(() => truncate(db, ["restaurants", "users", "guests", "rate_limits", "audit_logs"]));
afterAll(() => setPosProviderForTests(undefined, "1c"));

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).name),
  );

const BASE_URL = "https://1c.example.am/cafe/hs/spot/";

describe("1C over its HTTP service", () => {
  let oneC: ReturnType<typeof createFakeOneC>;
  beforeEach(() => {
    oneC = createFakeOneC();
    setPosProviderForTests(createOneCHttpProvider(oneC.transport));
  });

  async function connected() {
    const s = await orderingSetup();
    const connection = await connectPos(s.owner, s.restaurantId, {
      locationId: s.locationId,
      provider: "1c",
      settings: { baseUrl: BASE_URL, username: "spot" },
      secret: "secret-1c",
    });
    return { ...s, connection };
  }

  it("needs a public https address and a password, and keeps the password encrypted", async () => {
    const s = await orderingSetup();
    const connect = (settings: Record<string, string>, secret?: string) =>
      connectPos(s.owner, s.restaurantId, {
        locationId: s.locationId,
        provider: "1c",
        settings,
        secret,
      });
    expect(await codeOf(connect({ baseUrl: "http://1c.example.am", username: "spot" }, "x"))).toBe(
      "ZodError",
    );
    expect(
      await codeOf(connect({ baseUrl: "https://192.168.1.5/hs", username: "spot" }, "x")),
    ).toBe("ZodError");
    expect(await codeOf(connect({ baseUrl: BASE_URL, username: "spot" }))).toBe("VALIDATION_ERROR");

    const connection = await connect({ baseUrl: BASE_URL, username: "spot" }, "secret-1c");
    expect(connection.settings).toEqual({
      baseUrl: "https://1c.example.am/cafe/hs/spot",
      username: "spot",
    });
    expect(connection).not.toHaveProperty("secretCiphertext");
    const [row] = await db
      .select()
      .from(posConnections)
      .where(eq(posConnections.id, connection.id));
    expect(row!.secretCiphertext).toMatch(/^v1\./);
    expect(row!.secretCiphertext).not.toContain("secret-1c");
  });

  it("sends orders and status changes as exchange documents with Basic auth", async () => {
    const s = await connected();
    oneC.state.catalog = {
      items: [{ externalId: "00001", name: "Pizza", priceMinor: 350000 }],
      tables: [{ externalId: "T3", number: "3" }],
    };
    await linkPosCatalog(s.owner, s.restaurantId, s.connection.id);
    const order = await createOrder(s.ani, s.session.id, orderRequest(s));
    await changeOrderStatus(s.owner, s.restaurantId, order.id, "accepted");

    expect(await deliverPosOutbox()).toEqual({ sent: 2, retrying: 0, failed: 0 });
    const [created, status] = oneC.state.received;
    expect(created).toMatchObject({
      changeId: `spot-order-${order.id}`,
      type: "order.created",
      order: { id: order.id, table: { number: "3", externalId: "T3" }, note: "Birthday!" },
    });
    expect(created!.type === "order.created" && created!.order.lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ externalItemId: "00001", quantity: 2 })]),
    );
    expect(status).toMatchObject({
      type: "order.status",
      orderId: order.id,
      externalOrderId: "1c-1",
      status: "accepted",
    });
    const post = oneC.state.requests.find((r) => r.method === "POST")!;
    expect(post.url).toBe("https://1c.example.am/cafe/hs/spot/v1/changes");
    expect(post.headers).toMatchObject({ "x-spot-exchange-version": "1" });
  });

  it("retries 1C's outages and stops on wrong credentials", async () => {
    const s = await connected();
    await createOrder(s.ani, s.session.id, orderRequest(s));
    const now = new Date();
    oneC.state.nextResponses.push({ status: 503, body: "" });
    expect(await deliverPosOutbox({}, now)).toEqual({ sent: 0, retrying: 1, failed: 0 });
    oneC.state.nextResponses.push({ status: 401, body: "" });
    expect(await deliverPosOutbox({}, new Date(now.getTime() + 120_000))).toEqual({
      sent: 0,
      retrying: 0,
      failed: 1,
    });
    const [item] = await db.select().from(posOutbox);
    expect(item!.lastError).toBe("1C refused the user name or password.");
  });

  it("treats 1C's own refusals by their retry flag", async () => {
    const s = await connected();
    await createOrder(s.ani, s.session.id, orderRequest(s));
    const now = new Date();
    oneC.state.nextResponses.push({
      status: 200,
      body: JSON.stringify({ ok: false, error: "Base is locked", retry: true }),
    });
    expect(await deliverPosOutbox({}, now)).toMatchObject({ retrying: 1 });
    oneC.state.nextResponses.push({
      status: 200,
      body: JSON.stringify({ ok: false, error: "Unknown table" }),
    });
    expect(await deliverPosOutbox({}, new Date(now.getTime() + 120_000))).toMatchObject({
      failed: 1,
    });
    const [item] = await db.select().from(posOutbox);
    expect(item!.lastError).toBe("Unknown table");
  });

  it("follows 1C's stock", async () => {
    const s = await connected();
    oneC.state.catalog = {
      items: [{ externalId: "00002", name: "Soup", priceMinor: 1 }],
      tables: [],
    };
    await linkPosCatalog(s.owner, s.restaurantId, s.connection.id);
    oneC.state.stock = [{ externalId: "00002", available: 0 }];
    expect(await syncPosStock()).toEqual({ changed: 1 });
    const [soup] = await db.select().from(menuItems).where(eq(menuItems.id, s.soup.id));
    expect(soup!.isAvailable).toBe(false);
  });
});

describe("1C collecting changes from Spot", () => {
  async function connected() {
    const s = await orderingSetup();
    const connection = await connectPos(s.owner, s.restaurantId, {
      locationId: s.locationId,
      provider: "1c-exchange",
    });
    const request = (token = connection.exchangeToken!) =>
      new Request("https://spot.am/api/pos/1c/v1/changes", {
        headers: { authorization: `Bearer ${token}` },
      });
    const exchange = await authenticateExchange(request());
    return { ...s, connection, exchange, request };
  }

  it("gives out a token once and only accepts it while connected", async () => {
    const s = await connected();
    expect(s.connection.exchangeToken).toMatch(/^[\w-]{40,}$/);
    expect(s.exchange.id).toBe(s.connection.id);
    expect(await codeOf(authenticateExchange(s.request("x".repeat(43))))).toBe("UNAUTHORIZED");
    expect(
      await codeOf(authenticateExchange(new Request("https://spot.am/api/pos/1c/v1/changes"))),
    ).toBe("UNAUTHORIZED");

    const fresh = await rotateExchangeToken(s.owner, s.restaurantId, s.connection.id);
    expect(await codeOf(authenticateExchange(s.request()))).toBe("UNAUTHORIZED");
    await authenticateExchange(s.request(fresh));

    await disconnectPos(s.owner, s.restaurantId, s.connection.id);
    expect(await codeOf(authenticateExchange(s.request(fresh)))).toBe("UNAUTHORIZED");
  });

  it("hands out changes in order until 1C confirms them", async () => {
    const s = await connected();
    const order = await createOrder(s.ani, s.session.id, orderRequest(s));
    await changeOrderStatus(s.owner, s.restaurantId, order.id, "accepted");
    // Spot doesn't push to a POS that collects.
    expect(await deliverPosOutbox()).toEqual({ sent: 0, retrying: 0, failed: 0 });

    const first = await pullChanges(s.exchange);
    expect(first.changes.map((c) => c.type)).toEqual(["order.created", "order.status"]);
    expect(first.changes[1]).toMatchObject({ orderId: order.id, externalOrderId: null });
    // Unconfirmed changes come again.
    expect((await pullChanges(s.exchange)).changes).toHaveLength(2);

    const [created, status] = first.changes;
    expect(
      await acknowledgeChanges(s.exchange, {
        results: [
          { changeId: created!.changeId, ok: true, externalId: "DOC-17" },
          { changeId: created!.changeId, ok: true },
          { changeId: "00000000-0000-4000-8000-000000000000", ok: true },
        ],
      }),
    ).toEqual({
      accepted: 1,
      ignored: [created!.changeId, "00000000-0000-4000-8000-000000000000"],
    });
    const refs = await db.select().from(posExternalRefs);
    expect(refs).toEqual([expect.objectContaining({ localId: order.id, externalId: "DOC-17" })]);

    const second = await pullChanges(s.exchange);
    expect(second.changes).toEqual([
      expect.objectContaining({ changeId: status!.changeId, externalOrderId: "DOC-17" }),
    ]);
  });

  it("waits after 'try again' and gives up on refusals", async () => {
    const s = await connected();
    const order = await createOrder(s.ani, s.session.id, orderRequest(s));
    await changeOrderStatus(s.owner, s.restaurantId, order.id, "accepted");
    const now = new Date();
    const [created, status] = (await pullChanges(s.exchange, {}, now)).changes;

    await acknowledgeChanges(
      s.exchange,
      { results: [{ changeId: created!.changeId, ok: false, error: "Base is busy", retry: true }] },
      now,
    );
    expect((await pullChanges(s.exchange, {}, now)).changes).toEqual([]);
    const later = new Date(now.getTime() + 120_000);
    expect((await pullChanges(s.exchange, {}, later)).changes).toHaveLength(2);

    await acknowledgeChanges(
      s.exchange,
      {
        results: [
          { changeId: created!.changeId, ok: true },
          { changeId: status!.changeId, ok: false, error: "Status not supported" },
        ],
      },
      later,
    );
    const items = await db.select().from(posOutbox);
    expect(items.map((i) => [i.kind, i.status]).sort()).toEqual([
      ["order_created", "sent"],
      ["order_updated", "failed"],
    ]);
    const [connection] = await db
      .select()
      .from(posConnections)
      .where(eq(posConnections.id, s.connection.id));
    expect(connection!.lastError).toBe("Status not supported");
  });

  it("links the uploaded catalog and follows uploaded stock", async () => {
    const s = await connected();
    expect(await codeOf(linkPosCatalog(s.owner, s.restaurantId, s.connection.id))).toBe("CONFLICT");
    expect(
      await receiveCatalog(s.exchange, {
        items: [
          { externalId: "00001", name: "  Pizza ", priceMinor: 350000 },
          { externalId: "00002", name: "Soup", priceMinor: 200000, category: "Hot" },
        ],
        tables: [{ externalId: "T3", number: "3" }],
      }),
    ).toEqual({ items: 2, tables: 1 });
    expect(await linkPosCatalog(s.owner, s.restaurantId, s.connection.id)).toEqual({
      items: { linked: 2, unmatched: [] },
      tables: { linked: 1, unmatched: [] },
    });

    expect(
      await receiveStock(s.exchange, {
        stock: [
          { externalId: "00001", available: 0 },
          { externalId: "00002", available: 5 },
        ],
      }),
    ).toEqual({ changed: 1 });
    const [pizza] = await db.select().from(menuItems).where(eq(menuItems.id, s.pizza.id));
    expect(pizza!.isAvailable).toBe(false);

    expect(
      await codeOf(receiveStock(s.exchange, { stock: [{ externalId: "", available: -1 }] })),
    ).toBe("ZodError");
  });
});
