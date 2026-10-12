import "server-only";

import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { createToken, hashToken } from "@/server/crypto/tokens";
import { decryptSecret, encryptSecret } from "@/server/crypto/secret-box";
import { db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import {
  type Bill,
  diningTables,
  menuItems,
  orderItemModifiers,
  orderItems,
  orders,
  type PosConnection,
  posConnections,
  posExternalRefs,
  type PosOutboxItem,
  posOutbox,
  restaurantLocations,
} from "@/server/db/schema";
import { logger } from "@/server/logger";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { findPosProvider, availablePosProviders } from "@/server/pos/registry";
import {
  type CloseBillInput,
  type ExternalOrder,
  type ExternalOrderUpdate,
  type PosContext,
  PosPermanentError,
  type PosProvider,
} from "@/server/pos/provider";
import {
  POS_DELIVERY_LEASE_MS,
  POS_RETRY_DELAYS_MS,
  type PosEntityType,
} from "@/shared/constants/pos";
import { AppError } from "@/shared/errors";

/*
 * POS integration (§29). A location may be linked to its POS; nothing on
 * Spot depends on it. After an order or bill change is committed, a copy
 * goes into the POS outbox and is delivered in the background — per
 * connection, oldest first, with retries — so a slow or offline POS never
 * blocks guests or staff. Dishes and tables are linked to the POS's records
 * by name and number; linked dishes follow the POS's stock.
 */

type Actor = Pick<SessionUser, "id">;
const log = logger.child({ module: "pos" });

const settingsSchema = z
  .record(
    z.string().trim().min(1).max(64),
    z.union([z.string().max(500), z.number().finite(), z.boolean()]),
  )
  .refine((s) => Object.keys(s).length <= 20, "tooManySettings")
  .default({});

const connectSchema = z.object({
  locationId: z.uuid(),
  provider: z.string().trim().min(1).max(40),
  settings: settingsSchema,
  /** Password for POSes Spot calls; stored encrypted, never shown again. */
  secret: z.string().min(1).max(200).optional(),
});

const short = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 500);

async function connectionOf(restaurantId: string, connectionId: string) {
  if (!z.uuid().safeParse(connectionId).success) {
    throw new AppError("NOT_FOUND", "POS connection not found.");
  }
  const [connection] = await db
    .select()
    .from(posConnections)
    .where(and(eq(posConnections.id, connectionId), eq(posConnections.restaurantId, restaurantId)));
  if (!connection) throw new AppError("NOT_FOUND", "POS connection not found.");
  return connection;
}

export const contextOf = (connection: PosConnection): PosContext => ({
  connectionId: connection.id,
  settings: connection.settings,
  secret: connection.secretCiphertext ? decryptSecret(connection.secretCiphertext) : null,
});

/** A connection without its stored secrets. */
export type PublicPosConnection = Omit<PosConnection, "secretCiphertext" | "exchangeTokenHash">;
function publicView(connection: PosConnection): PublicPosConnection {
  const view: Partial<PosConnection> = { ...connection };
  delete view.secretCiphertext;
  delete view.exchangeTokenHash;
  return view as PublicPosConnection;
}

/* ----------------------------- Connections ----------------------------- */

/**
 * Link a location to its POS (location:manage). One live POS per location.
 * For a POS that calls Spot, the result carries its exchange token — shown
 * once, stored only as a hash.
 */
export async function connectPos(
  actor: Actor,
  restaurantId: string,
  input: unknown,
): Promise<PublicPosConnection & { exchangeToken?: string }> {
  await authorizeRestaurant(actor.id, restaurantId, "location:manage");
  const data = connectSchema.parse(input);
  const provider = findPosProvider(data.provider);
  if (!provider) {
    throw new AppError("RESOURCE_UNAVAILABLE", "This POS system isn't supported yet.");
  }
  const settings = provider.parseSettings ? provider.parseSettings(data.settings) : data.settings;
  if (provider.needsSecret && !data.secret) {
    throw new AppError("VALIDATION_ERROR", "Enter the POS password.", {
      fieldErrors: { secret: ["required"] },
    });
  }
  const exchangeToken = provider.pulls ? createToken() : undefined;
  const [location] = await db
    .select({ id: restaurantLocations.id })
    .from(restaurantLocations)
    .where(
      and(
        eq(restaurantLocations.id, data.locationId),
        eq(restaurantLocations.restaurantId, restaurantId),
      ),
    );
  if (!location) throw new AppError("NOT_FOUND", "Location not found.");
  try {
    return await db.transaction(async (tx) => {
      const [connection] = await tx
        .insert(posConnections)
        .values({
          restaurantId,
          locationId: data.locationId,
          provider: data.provider,
          settings,
          secretCiphertext: provider.needsSecret ? encryptSecret(data.secret!) : null,
          exchangeTokenHash: exchangeToken ? hashToken(exchangeToken) : null,
        })
        .returning();
      await recordAudit(tx, {
        actor,
        action: "pos.connected",
        entityType: "pos_connection",
        entityId: connection!.id,
        restaurantId,
        metadata: { provider: data.provider, locationId: data.locationId },
      });
      return { ...publicView(connection!), ...(exchangeToken && { exchangeToken }) };
    });
  } catch (error) {
    if (isUniqueViolation(error, "pos_connections_one_active_per_location")) {
      throw new AppError("CONFLICT", "This location is already connected to a POS.");
    }
    throw error;
  }
}

/** Stop sending to the POS (location:manage). Undelivered changes stay, unsent. */
export async function disconnectPos(actor: Actor, restaurantId: string, connectionId: string) {
  await authorizeRestaurant(actor.id, restaurantId, "location:manage");
  const connection = await connectionOf(restaurantId, connectionId);
  if (connection.status === "disabled") return;
  await db.transaction(async (tx) => {
    await tx
      .update(posConnections)
      .set({ status: "disabled" })
      .where(eq(posConnections.id, connection.id));
    await recordAudit(tx, {
      actor,
      action: "pos.disconnected",
      entityType: "pos_connection",
      entityId: connection.id,
      restaurantId,
      metadata: { provider: connection.provider },
    });
  });
}

/** A new exchange token for a POS that calls Spot (location:manage); the old one stops working. */
export async function rotateExchangeToken(
  actor: Actor,
  restaurantId: string,
  connectionId: string,
) {
  await authorizeRestaurant(actor.id, restaurantId, "location:manage");
  const connection = await connectionOf(restaurantId, connectionId);
  if (!findPosProvider(connection.provider)?.pulls) {
    throw new AppError("CONFLICT", "This POS doesn't use an exchange token.");
  }
  const token = createToken();
  await db
    .update(posConnections)
    .set({ exchangeTokenHash: hashToken(token) })
    .where(eq(posConnections.id, connection.id));
  return token;
}

export interface PosConnectionView {
  id: string;
  locationId: string;
  locationName: string;
  provider: string;
  status: PosConnection["status"];
  lastSyncAt: Date | null;
  lastError: string | null;
  pending: number;
  failed: number;
}

/** A restaurant's POS connections with their delivery health (location:manage). */
export async function listPosConnections(
  actor: Actor,
  restaurantId: string,
): Promise<{ connections: PosConnectionView[]; providers: string[] }> {
  await authorizeRestaurant(actor.id, restaurantId, "location:manage");
  const rows = await db
    .select({
      id: posConnections.id,
      locationId: posConnections.locationId,
      locationName: restaurantLocations.name,
      provider: posConnections.provider,
      status: posConnections.status,
      lastSyncAt: posConnections.lastSyncAt,
      lastError: posConnections.lastError,
      pending: sql<number>`(SELECT count(*)::int FROM pos_outbox o WHERE o.connection_id = ${posConnections.id} AND o.status = 'pending')`,
      failed: sql<number>`(SELECT count(*)::int FROM pos_outbox o WHERE o.connection_id = ${posConnections.id} AND o.status = 'failed')`,
    })
    .from(posConnections)
    .innerJoin(restaurantLocations, eq(restaurantLocations.id, posConnections.locationId))
    .where(eq(posConnections.restaurantId, restaurantId))
    .orderBy(asc(restaurantLocations.name), asc(posConnections.createdAt));
  return { connections: rows, providers: availablePosProviders() };
}

/** Send failed changes again (location:manage), e.g. after fixing a link in the POS. */
export async function retryFailedPosItems(
  actor: Actor,
  restaurantId: string,
  connectionId: string,
  now = new Date(),
) {
  await authorizeRestaurant(actor.id, restaurantId, "location:manage");
  const connection = await connectionOf(restaurantId, connectionId);
  const retried = await db
    .update(posOutbox)
    .set({ status: "pending", attempts: 0, nextAttemptAt: now, lastError: null })
    .where(and(eq(posOutbox.connectionId, connection.id), eq(posOutbox.status, "failed")))
    .returning({ id: posOutbox.id });
  if (retried.length > 0) scheduleDelivery(connection.id);
  return retried.length;
}

/* -------------------------------- Outbox -------------------------------- */

/** Deliver right after the response when running in a request; otherwise the POS job does it. */
function scheduleDelivery(connectionId: string) {
  try {
    after(() =>
      deliverPosOutbox({ connectionId }).catch((err: unknown) =>
        log.error("POS delivery failed", { err, connectionId }),
      ),
    );
  } catch {
    // Not inside a request (scripts, tests): the POS job picks it up.
  }
}

async function activeConnectionAt(locationId: string) {
  const [connection] = await db
    .select({ id: posConnections.id })
    .from(posConnections)
    .where(and(eq(posConnections.locationId, locationId), eq(posConnections.status, "active")));
  return connection ?? null;
}

/**
 * Queue an order change for the location's POS, if it has one. Called after
 * the change is committed; never throws — the POS is optional.
 */
export async function queueOrderForPos(
  orderId: string,
  kind: "order_created" | "order_updated",
): Promise<void> {
  try {
    const [order] = await db
      .select({
        id: orders.id,
        locationId: orders.locationId,
        number: orders.number,
        status: orders.status,
        cancelReason: orders.cancelReason,
        currency: orders.currency,
        totalMinor: orders.totalMinor,
        note: orders.note,
        submittedAt: orders.submittedAt,
        tableId: orders.tableId,
        tableNumber: diningTables.number,
      })
      .from(orders)
      .innerJoin(diningTables, eq(diningTables.id, orders.tableId))
      .where(eq(orders.id, orderId));
    if (!order) return;
    const connection = await activeConnectionAt(order.locationId);
    if (!connection) return;

    let payload: Record<string, unknown>;
    if (kind === "order_created") {
      const lines = await db
        .select({
          id: orderItems.id,
          menuItemId: orderItems.menuItemId,
          name: orderItems.name,
          quantity: orderItems.quantity,
          unitPriceMinor: orderItems.unitPriceMinor,
          lineTotalMinor: orderItems.lineTotalMinor,
          note: orderItems.note,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id))
        .orderBy(asc(orderItems.createdAt), asc(orderItems.id));
      const options = lines.length
        ? await db
            .select({ itemId: orderItemModifiers.orderItemId, name: orderItemModifiers.name })
            .from(orderItemModifiers)
            .where(
              inArray(
                orderItemModifiers.orderItemId,
                lines.map((l) => l.id),
              ),
            )
        : [];
      payload = {
        number: order.number,
        tableId: order.tableId,
        tableNumber: order.tableNumber,
        currency: order.currency,
        totalMinor: order.totalMinor,
        note: order.note,
        submittedAt: order.submittedAt.toISOString(),
        lines: lines.map(({ id, ...line }) => ({
          ...line,
          options: options.filter((o) => o.itemId === id).map((o) => o.name),
        })),
      };
    } else {
      payload = { status: order.status, reason: order.cancelReason };
    }
    await db.insert(posOutbox).values({
      connectionId: connection.id,
      kind,
      entityId: order.id,
      payload,
      nextAttemptAt: new Date(),
    });
    scheduleDelivery(connection.id);
  } catch (err) {
    log.error("Couldn't queue order for the POS", { err, orderId, kind });
  }
}

/** Queue "bill paid" for the location's POS, if it has one. Never throws. */
export async function queueBillClosedForPos(bill: Bill): Promise<void> {
  try {
    if (bill.status !== "paid") return;
    const connection = await activeConnectionAt(bill.locationId);
    if (!connection) return;
    const billed = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.tableSessionId, bill.tableSessionId),
          notInArray(orders.status, ["cancelled", "rejected"]),
        ),
      );
    await db.insert(posOutbox).values({
      connectionId: connection.id,
      kind: "bill_closed",
      nextAttemptAt: new Date(),
      entityId: bill.id,
      payload: {
        currency: bill.currency,
        totalMinor: bill.totalMinor,
        serviceFeeMinor: bill.serviceFeeMinor,
        paidMinor: bill.paidMinor,
        orderIds: billed.map((o) => o.id),
      },
    });
    scheduleDelivery(connection.id);
  } catch (err) {
    log.error("Couldn't queue bill for the POS", { err, billId: bill.id });
  }
}

/** POS ids for some of our records on a connection. */
async function externalIds(connectionId: string, entityType: PosEntityType, localIds: string[]) {
  const ids = [...new Set(localIds)];
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ localId: posExternalRefs.localId, externalId: posExternalRefs.externalId })
    .from(posExternalRefs)
    .where(
      and(
        eq(posExternalRefs.connectionId, connectionId),
        eq(posExternalRefs.entityType, entityType),
        inArray(posExternalRefs.localId, ids),
      ),
    );
  return new Map(rows.map((r) => [r.localId, r.externalId]));
}

interface CreatedPayload {
  number: number;
  tableId: string;
  tableNumber: string;
  currency: string;
  totalMinor: number;
  note: string | null;
  submittedAt: string;
  lines: (Omit<ExternalOrder["lines"][number], "externalItemId"> & { menuItemId: string })[];
}

export type PreparedChange =
  | { kind: "order_created"; input: ExternalOrder }
  | { kind: "order_updated"; input: ExternalOrderUpdate }
  | { kind: "bill_closed"; input: CloseBillInput };

/**
 * An outbox item as the POS should see it, with our ids translated to the
 * POS's where they're linked. `requireRefs`: the POS needs its own order
 * ids (it gave them to us), so a change for an order it never got can't go.
 */
export async function prepareChange(
  item: PosOutboxItem,
  { requireRefs }: { requireRefs: boolean },
): Promise<PreparedChange> {
  const connectionId = item.connectionId;
  if (item.kind === "order_created") {
    const p = item.payload as unknown as CreatedPayload;
    const [items, tables] = await Promise.all([
      externalIds(
        connectionId,
        "menu_item",
        p.lines.map((l) => l.menuItemId),
      ),
      externalIds(connectionId, "table", [p.tableId]),
    ]);
    return {
      kind: item.kind,
      input: {
        idempotencyKey: `spot-order-${item.entityId}`,
        orderId: item.entityId,
        number: p.number,
        tableNumber: p.tableNumber,
        externalTableId: tables.get(p.tableId) ?? null,
        currency: p.currency,
        totalMinor: p.totalMinor,
        note: p.note,
        submittedAt: p.submittedAt,
        lines: p.lines.map(({ menuItemId, ...line }) => ({
          ...line,
          externalItemId: items.get(menuItemId) ?? null,
        })),
      },
    };
  }

  if (item.kind === "order_updated") {
    const p = item.payload as { status: string; reason: string | null };
    const externalOrderId =
      (await externalIds(connectionId, "order", [item.entityId])).get(item.entityId) ?? null;
    if (!externalOrderId && requireRefs) {
      throw new PosPermanentError("The order never reached the POS.");
    }
    return {
      kind: item.kind,
      input: {
        idempotencyKey: `spot-outbox-${item.id}`,
        orderId: item.entityId,
        externalOrderId,
        status: p.status,
        reason: p.reason,
      },
    };
  }

  const p = item.payload as {
    currency: string;
    totalMinor: number;
    serviceFeeMinor: number;
    paidMinor: number;
    orderIds: string[];
  };
  const refs = await externalIds(connectionId, "order", p.orderIds);
  if (refs.size === 0 && requireRefs) {
    throw new PosPermanentError("None of the bill's orders reached the POS.");
  }
  return {
    kind: "bill_closed",
    input: {
      idempotencyKey: `spot-bill-${item.entityId}`,
      billId: item.entityId,
      orderIds: p.orderIds,
      externalOrderIds: p.orderIds.flatMap((id) => refs.get(id) ?? []),
      currency: p.currency,
      totalMinor: p.totalMinor,
      serviceFeeMinor: p.serviceFeeMinor,
      paidMinor: p.paidMinor,
    },
  };
}

/** Remember the POS's id for an order it accepted. */
export async function rememberExternalOrder(
  connectionId: string,
  orderId: string,
  externalId: string,
) {
  await db
    .insert(posExternalRefs)
    .values({ connectionId, entityType: "order", localId: orderId, externalId })
    .onConflictDoNothing();
}

async function deliverItem(provider: PosProvider, context: PosContext, item: PosOutboxItem) {
  const change = await prepareChange(item, { requireRefs: true });
  if (change.kind === "order_created") {
    const { externalOrderId } = await provider.createOrder(context, change.input);
    await rememberExternalOrder(item.connectionId, item.entityId, externalOrderId);
  } else if (change.kind === "order_updated") {
    await provider.updateOrder(context, change.input);
  } else {
    await provider.closeBill(context, change.input);
  }
}

export interface DeliveryResult {
  sent: number;
  retrying: number;
  failed: number;
}

/**
 * Send due outbox items to their POS. Each connection is worked by one run
 * at a time (a short lease) and strictly oldest first: while the oldest item
 * waits for a retry, later ones wait too, so the POS never sees a status
 * change before the order. Items that can't succeed are marked failed and
 * skipped so they don't block the rest.
 */
export async function deliverPosOutbox(
  options: { connectionId?: string; limit?: number } = {},
  now = new Date(),
): Promise<DeliveryResult> {
  const result: DeliveryResult = { sent: 0, retrying: 0, failed: 0 };
  const connections = await db
    .select()
    .from(posConnections)
    .where(
      and(
        eq(posConnections.status, "active"),
        options.connectionId ? eq(posConnections.id, options.connectionId) : undefined,
        sql`EXISTS (SELECT 1 FROM pos_outbox o WHERE o.connection_id = ${posConnections.id}
                    AND o.status = 'pending' AND o.next_attempt_at <= ${now.toISOString()})`,
      ),
    );

  for (const connection of connections) {
    // POSes that collect their changes themselves acknowledge them (pos-exchange-service).
    if (findPosProvider(connection.provider)?.pulls) continue;
    const [leased] = await db
      .update(posConnections)
      .set({ deliveryLeaseUntil: new Date(now.getTime() + POS_DELIVERY_LEASE_MS) })
      .where(
        and(
          eq(posConnections.id, connection.id),
          or(isNull(posConnections.deliveryLeaseUntil), lt(posConnections.deliveryLeaseUntil, now)),
        ),
      )
      .returning({ id: posConnections.id });
    if (!leased) continue; // another run is on it

    let lastError: string | null = null;
    try {
      const provider = findPosProvider(connection.provider);
      if (!provider) {
        lastError = `The ${connection.provider} POS adapter isn't available.`;
        continue;
      }
      const items = await db
        .select()
        .from(posOutbox)
        .where(and(eq(posOutbox.connectionId, connection.id), eq(posOutbox.status, "pending")))
        .orderBy(asc(posOutbox.createdAt), asc(posOutbox.id))
        .limit(Math.min(options.limit ?? 50, 200));

      for (const item of items) {
        if (item.nextAttemptAt > now) break;
        try {
          await deliverItem(provider, contextOf(connection), item);
          await db
            .update(posOutbox)
            .set({ status: "sent", sentAt: now, attempts: item.attempts + 1, lastError: null })
            .where(eq(posOutbox.id, item.id));
          result.sent++;
        } catch (err) {
          lastError = short(err);
          const attempts = item.attempts + 1;
          const delay = POS_RETRY_DELAYS_MS[attempts - 1];
          if (err instanceof PosPermanentError || delay === undefined) {
            await db
              .update(posOutbox)
              .set({ status: "failed", attempts, lastError })
              .where(eq(posOutbox.id, item.id));
            result.failed++;
            log.warn("POS rejected a change", { connectionId: connection.id, kind: item.kind });
            continue;
          }
          await db
            .update(posOutbox)
            .set({ attempts, lastError, nextAttemptAt: new Date(now.getTime() + delay) })
            .where(eq(posOutbox.id, item.id));
          result.retrying++;
          break;
        }
      }
    } finally {
      await db
        .update(posConnections)
        .set({
          deliveryLeaseUntil: null,
          lastError,
          ...(lastError === null && { lastSyncAt: now }),
        })
        .where(eq(posConnections.id, connection.id));
    }
  }
  return result;
}

/* ------------------------- Catalog and stock ------------------------- */

const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

/** Pair records whose keys match exactly once on both sides. */
function pairUp<A, B>(ours: A[], theirs: B[], keyA: (a: A) => string, keyB: (b: B) => string) {
  const count = <T>(list: T[], key: (t: T) => string) => {
    const counts = new Map<string, number>();
    for (const t of list) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
    return counts;
  };
  const oursCount = count(ours, keyA);
  const theirsCount = count(theirs, keyB);
  const byKey = new Map(ours.map((a) => [keyA(a), a]));
  const pairs: [A, B][] = [];
  const unmatched: B[] = [];
  for (const b of theirs) {
    const key = keyB(b);
    const a = byKey.get(key);
    if (a && oursCount.get(key) === 1 && theirsCount.get(key) === 1) pairs.push([a, b]);
    else unmatched.push(b);
  }
  return { pairs, unmatched };
}

export interface CatalogLinkResult {
  items: { linked: number; unmatched: string[] };
  tables: { linked: number; unmatched: string[] };
}

/**
 * Link our dishes and tables to the POS's by name and table number
 * (location:manage). Ambiguous names (twice on either side) stay unlinked.
 * Running it again replaces the previous links.
 */
export async function linkPosCatalog(
  actor: Actor,
  restaurantId: string,
  connectionId: string,
  now = new Date(),
): Promise<CatalogLinkResult> {
  await authorizeRestaurant(actor.id, restaurantId, "location:manage");
  const connection = await connectionOf(restaurantId, connectionId);
  if (connection.status !== "active") throw new AppError("CONFLICT", "This POS is disconnected.");
  const provider = findPosProvider(connection.provider);
  if (!provider) throw new AppError("RESOURCE_UNAVAILABLE", "This POS system isn't supported yet.");

  let menu, tables;
  try {
    [menu, tables] = await Promise.all([
      provider.getMenu(contextOf(connection)),
      provider.getTables(contextOf(connection)),
    ]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    await db
      .update(posConnections)
      .set({ lastError: short(err) })
      .where(eq(posConnections.id, connection.id));
    throw new AppError("RESOURCE_UNAVAILABLE", "The POS didn't answer. Try again later.");
  }

  const [ourItems, ourTables] = await Promise.all([
    db
      .select({ id: menuItems.id, name: menuItems.name })
      .from(menuItems)
      .where(eq(menuItems.restaurantId, restaurantId)),
    db
      .select({ id: diningTables.id, number: diningTables.number })
      .from(diningTables)
      .where(eq(diningTables.locationId, connection.locationId)),
  ]);
  const items = pairUp(
    ourItems,
    menu.items,
    (a) => normalize(a.name),
    (b) => normalize(b.name),
  );
  const tablePairs = pairUp(
    ourTables,
    tables,
    (a) => normalize(a.number),
    (b) => normalize(b.number),
  );

  await db.transaction(async (tx) => {
    await tx
      .delete(posExternalRefs)
      .where(
        and(
          eq(posExternalRefs.connectionId, connection.id),
          inArray(posExternalRefs.entityType, ["menu_item", "table"]),
        ),
      );
    const rows = [
      ...items.pairs.map(([a, b]) => ({
        connectionId: connection.id,
        entityType: "menu_item" as const,
        localId: a.id,
        externalId: b.externalId,
      })),
      ...tablePairs.pairs.map(([a, b]) => ({
        connectionId: connection.id,
        entityType: "table" as const,
        localId: a.id,
        externalId: b.externalId,
      })),
    ];
    if (rows.length > 0) await tx.insert(posExternalRefs).values(rows);
    await tx
      .update(posConnections)
      .set({ lastSyncAt: now, lastError: null })
      .where(eq(posConnections.id, connection.id));
  });

  return {
    items: { linked: items.pairs.length, unmatched: items.unmatched.map((i) => i.name) },
    tables: {
      linked: tablePairs.pairs.length,
      unmatched: tablePairs.unmatched.map((t) => t.number),
    },
  };
}

/**
 * Follow the POS's stock for linked dishes: sold out there → unavailable
 * here, back in stock → available. Dishes the POS doesn't report are left
 * alone. Runs from the POS job; a POS that doesn't answer is skipped.
 */
export async function syncPosStock(
  now = new Date(),
  options: { connectionId?: string } = {},
): Promise<{ changed: number }> {
  const connections = await db
    .select()
    .from(posConnections)
    .where(
      and(
        eq(posConnections.status, "active"),
        options.connectionId ? eq(posConnections.id, options.connectionId) : undefined,
        sql`EXISTS (SELECT 1 FROM pos_external_refs r WHERE r.connection_id = ${posConnections.id}
                    AND r.entity_type = 'menu_item')`,
      ),
    );
  let changed = 0;
  for (const connection of connections) {
    const provider = findPosProvider(connection.provider);
    if (!provider) continue;
    let stock;
    try {
      stock = await provider.getStock(contextOf(connection));
    } catch (err) {
      await db
        .update(posConnections)
        .set({ lastError: short(err) })
        .where(eq(posConnections.id, connection.id));
      continue;
    }
    const levels = new Map(stock.map((s) => [s.externalId, s.available]));
    const links = await db
      .select({ localId: posExternalRefs.localId, externalId: posExternalRefs.externalId })
      .from(posExternalRefs)
      .where(
        and(
          eq(posExternalRefs.connectionId, connection.id),
          eq(posExternalRefs.entityType, "menu_item"),
        ),
      );
    const soldOut = links.filter((l) => levels.get(l.externalId) === 0).map((l) => l.localId);
    const inStock = links.filter((l) => (levels.get(l.externalId) ?? 0) > 0).map((l) => l.localId);
    for (const [ids, available] of [
      [soldOut, false],
      [inStock, true],
    ] as const) {
      if (ids.length === 0) continue;
      const updated = await db
        .update(menuItems)
        .set({ isAvailable: available })
        .where(
          and(
            eq(menuItems.restaurantId, connection.restaurantId),
            inArray(menuItems.id, ids),
            eq(menuItems.isAvailable, !available),
          ),
        )
        .returning({ id: menuItems.id });
      changed += updated.length;
    }
    await db
      .update(posConnections)
      .set({ lastSyncAt: now })
      .where(eq(posConnections.id, connection.id));
  }
  return { changed };
}
