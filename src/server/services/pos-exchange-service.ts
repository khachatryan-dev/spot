import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { hashToken } from "@/server/crypto/tokens";
import { db } from "@/server/db/client";
import {
  type PosConnection,
  posCatalogSnapshots,
  posConnections,
  posOutbox,
} from "@/server/db/schema";
import { readLimitedText } from "@/server/http/read-limited";
import {
  acknowledgementSchema,
  billClosedDocument,
  catalogSchema,
  type ChangeDocument,
  orderCreatedDocument,
  orderStatusDocument,
  stockSchema,
} from "@/server/pos/onec/exchange-format";
import { findPosProvider } from "@/server/pos/registry";
import { hitRateLimit } from "@/server/rate-limit/rate-limit";
import { POS_RETRY_DELAYS_MS } from "@/shared/constants/pos";
import { AppError } from "@/shared/errors";

import { prepareChange, rememberExternalOrder, syncPosStock } from "./pos-service";

/*
 * Spot's side of the 1C exchange (docs/pos-1c.md): 1C authenticates with its
 * connection's exchange token, collects pending changes oldest first,
 * confirms each one, and uploads its menu, tables and stock. A change stays
 * pending until 1C confirms it, so a lost answer just means 1C sees the same
 * change again (it must skip change ids it already applied).
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const EXCHANGE_LIMIT = { max: 300, windowMs: 60_000 };

/** The active pulling connection behind a request's bearer token. */
export async function authenticateExchange(request: Request): Promise<PosConnection> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S{20,200})$/i.exec(header)?.[1];
  if (!token) throw new AppError("UNAUTHORIZED", "Exchange token required.");
  const tokenHash = hashToken(token);
  const [connection] = await db
    .select()
    .from(posConnections)
    .where(
      and(eq(posConnections.exchangeTokenHash, tokenHash), eq(posConnections.status, "active")),
    );
  if (!connection || !findPosProvider(connection.provider)?.pulls) {
    throw new AppError("UNAUTHORIZED", "Exchange token not recognized.");
  }
  if (!(await hitRateLimit(`pos-exchange:${connection.id}`, EXCHANGE_LIMIT)).allowed) {
    throw new AppError("RATE_LIMITED", "Too many exchange requests.");
  }
  return connection;
}

export async function readExchangeBody(request: Request): Promise<unknown> {
  const text = await readLimitedText(request, MAX_BODY_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_ERROR", "The body isn't JSON.");
  }
}

/** Pending changes, oldest first, stopping at one that waits for a retry. */
export async function pullChanges(
  connection: PosConnection,
  options: { limit?: number } = {},
  now = new Date(),
): Promise<{ changes: ChangeDocument[] }> {
  const items = await db
    .select()
    .from(posOutbox)
    .where(and(eq(posOutbox.connectionId, connection.id), eq(posOutbox.status, "pending")))
    .orderBy(asc(posOutbox.createdAt), asc(posOutbox.id))
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 200));
  const changes: ChangeDocument[] = [];
  for (const item of items) {
    if (item.nextAttemptAt > now) break;
    const change = await prepareChange(item, { requireRefs: false });
    changes.push(
      change.kind === "order_created"
        ? orderCreatedDocument(item.id, change.input)
        : change.kind === "order_updated"
          ? orderStatusDocument(item.id, change.input)
          : billClosedDocument(item.id, change.input),
    );
  }
  await db
    .update(posConnections)
    .set({ lastSyncAt: now })
    .where(eq(posConnections.id, connection.id));
  return { changes };
}

/**
 * 1C's answers: applied (with its order id for new orders), refused for
 * good, or "try again later". Unknown or already settled change ids are
 * ignored and listed back.
 */
export async function acknowledgeChanges(
  connection: PosConnection,
  body: unknown,
  now = new Date(),
): Promise<{ accepted: number; ignored: string[] }> {
  const { results } = acknowledgementSchema.parse(body);
  const items = await db
    .select()
    .from(posOutbox)
    .where(
      and(
        eq(posOutbox.connectionId, connection.id),
        eq(posOutbox.status, "pending"),
        inArray(
          posOutbox.id,
          results.map((r) => r.changeId),
        ),
      ),
    );
  const byId = new Map(items.map((i) => [i.id, i]));
  const ignored: string[] = [];
  let accepted = 0;
  let lastError: string | null = null;

  for (const result of results) {
    const item = byId.get(result.changeId);
    if (!item) {
      ignored.push(result.changeId);
      continue;
    }
    byId.delete(result.changeId); // the same id twice counts once
    const attempts = item.attempts + 1;
    if (result.ok) {
      const [settled] = await db
        .update(posOutbox)
        .set({ status: "sent", sentAt: now, attempts, lastError: null })
        .where(and(eq(posOutbox.id, item.id), eq(posOutbox.status, "pending")))
        .returning({ id: posOutbox.id });
      if (!settled) {
        ignored.push(result.changeId);
        continue;
      }
      if (item.kind === "order_created" && result.externalId) {
        await rememberExternalOrder(connection.id, item.entityId, result.externalId);
      }
    } else {
      lastError = result.error;
      const delay = POS_RETRY_DELAYS_MS[attempts - 1];
      await db
        .update(posOutbox)
        .set(
          result.retry && delay !== undefined
            ? { attempts, lastError, nextAttemptAt: new Date(now.getTime() + delay) }
            : { status: "failed", attempts, lastError },
        )
        .where(and(eq(posOutbox.id, item.id), eq(posOutbox.status, "pending")));
    }
    accepted++;
  }
  await db
    .update(posConnections)
    .set({ lastSyncAt: now, lastError })
    .where(eq(posConnections.id, connection.id));
  return { accepted, ignored };
}

/** 1C uploads its menu and tables (replaces the previous upload). */
export async function receiveCatalog(connection: PosConnection, body: unknown, now = new Date()) {
  const catalog = catalogSchema.parse(body);
  await db
    .insert(posCatalogSnapshots)
    .values({
      connectionId: connection.id,
      menu: catalog.items,
      tables: catalog.tables,
      catalogReceivedAt: now,
    })
    .onConflictDoUpdate({
      target: posCatalogSnapshots.connectionId,
      set: { menu: catalog.items, tables: catalog.tables, catalogReceivedAt: now },
    });
  return { items: catalog.items.length, tables: catalog.tables.length };
}

/** 1C uploads its stock; linked dishes follow it at once. */
export async function receiveStock(connection: PosConnection, body: unknown, now = new Date()) {
  const { stock } = stockSchema.parse(body);
  await db
    .insert(posCatalogSnapshots)
    .values({ connectionId: connection.id, stock, stockReceivedAt: now })
    .onConflictDoUpdate({
      target: posCatalogSnapshots.connectionId,
      set: { stock, stockReceivedAt: now },
    });
  return syncPosStock(now, { connectionId: connection.id });
}
