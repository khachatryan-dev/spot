import "server-only";

import { randomBytes } from "node:crypto";

import { and, asc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db, type Transaction } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import {
  diningTables,
  type QrToken,
  qrTokens,
  restaurantLocations,
  restaurants,
} from "@/server/db/schema";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { AppError } from "@/shared/errors";

/*
 * Table QR codes (§13, §49 #5–6). Tokens are 128-bit random values — never
 * derived from table ids or numbers — and a revoked or expired token never
 * resolves, so it can't start a table session.
 */

type Actor = Pick<SessionUser, "id">;

/** 16 random bytes → 22 URL-safe characters (keeps the QR code small and easy to scan). */
export const generateQrToken = () => randomBytes(16).toString("base64url");

/** Matches the DB check; anything else is rejected before touching the database. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

/** Don't write last_scanned_at on every scan; once a minute is plenty for metrics. */
const SCAN_TOUCH_INTERVAL = sql`interval '1 minute'`;

async function authorize(actor: Actor, restaurantId: string) {
  const access = await authorizeRestaurant(actor.id, restaurantId, "qr:manage");
  if (access.restaurantStatus === "closed") {
    throw new AppError("CONFLICT", "A closed restaurant can't be edited.");
  }
}

/** Lock the table row (serializes concurrent create/rotate/revoke for one table). */
async function lockTable(tx: Transaction, restaurantId: string, tableId: string) {
  if (!z.uuid().safeParse(tableId).success) throw new AppError("NOT_FOUND", "Table not found.");
  const [table] = await tx
    .select({ id: diningTables.id, number: diningTables.number })
    .from(diningTables)
    .where(and(eq(diningTables.id, tableId), eq(diningTables.restaurantId, restaurantId)))
    .for("update");
  if (!table) throw new AppError("NOT_FOUND", "Table not found.");
  return table;
}

async function activeToken(tx: Transaction | typeof db, tableId: string) {
  const [token] = await tx
    .select()
    .from(qrTokens)
    .where(and(eq(qrTokens.tableId, tableId), isNull(qrTokens.revokedAt)));
  return token ?? null;
}

async function insertToken(tx: Transaction, restaurantId: string, tableId: string, actor: Actor) {
  // A collision of 128-bit random values is practically impossible; retry anyway.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [created] = await tx
        .insert(qrTokens)
        .values({ restaurantId, tableId, token: generateQrToken(), createdByUserId: actor.id })
        .returning();
      return created!;
    } catch (error) {
      if (!isUniqueViolation(error, "qr_tokens_token_unique")) throw error;
    }
  }
  throw new Error("Could not generate a unique QR token");
}

/** The table's live QR token, creating one if it has none. Safe to call repeatedly. */
export async function ensureTableQr(
  actor: Actor,
  restaurantId: string,
  tableId: string,
): Promise<QrToken> {
  await authorize(actor, restaurantId);
  return db.transaction(async (tx) => {
    const table = await lockTable(tx, restaurantId, tableId);
    const existing = await activeToken(tx, tableId);
    if (existing) return existing;
    const created = await insertToken(tx, restaurantId, tableId, actor);
    await recordAudit(tx, {
      actor,
      action: "qr.created",
      entityType: "table",
      entityId: tableId,
      restaurantId,
      metadata: { table: table.number },
    });
    return created;
  });
}

/** Revoke the current token and issue a new one (e.g. a code was photographed and misused). */
export async function rotateTableQr(
  actor: Actor,
  restaurantId: string,
  tableId: string,
): Promise<QrToken> {
  await authorize(actor, restaurantId);
  return db.transaction(async (tx) => {
    const table = await lockTable(tx, restaurantId, tableId);
    await tx
      .update(qrTokens)
      .set({ revokedAt: new Date(), revokedByUserId: actor.id })
      .where(and(eq(qrTokens.tableId, tableId), isNull(qrTokens.revokedAt)));
    const created = await insertToken(tx, restaurantId, tableId, actor);
    await recordAudit(tx, {
      actor,
      action: "qr.rotated",
      entityType: "table",
      entityId: tableId,
      restaurantId,
      metadata: { table: table.number },
    });
    return created;
  });
}

/** Disable the table's QR code without a replacement. */
export async function revokeTableQr(
  actor: Actor,
  restaurantId: string,
  tableId: string,
): Promise<void> {
  await authorize(actor, restaurantId);
  await db.transaction(async (tx) => {
    const table = await lockTable(tx, restaurantId, tableId);
    const revoked = await tx
      .update(qrTokens)
      .set({ revokedAt: new Date(), revokedByUserId: actor.id })
      .where(and(eq(qrTokens.tableId, tableId), isNull(qrTokens.revokedAt)))
      .returning({ id: qrTokens.id });
    if (revoked.length === 0) return;
    await recordAudit(tx, {
      actor,
      action: "qr.revoked",
      entityType: "table",
      entityId: tableId,
      restaurantId,
      metadata: { table: table.number },
    });
  });
}

export interface TableQr {
  tableId: string;
  number: string;
  name: string | null;
  isActive: boolean;
  token: string | null;
  lastScannedAt: Date | null;
}

/** Every table of a location with its live token (for the QR page and print sheet). */
export async function listLocationQr(
  actor: Actor,
  restaurantId: string,
  locationId: string,
): Promise<TableQr[]> {
  await authorizeRestaurant(actor.id, restaurantId, "qr:manage");
  if (!z.uuid().safeParse(locationId).success)
    throw new AppError("NOT_FOUND", "Location not found.");
  const [location] = await db
    .select({ id: restaurantLocations.id })
    .from(restaurantLocations)
    .where(
      and(
        eq(restaurantLocations.id, locationId),
        eq(restaurantLocations.restaurantId, restaurantId),
      ),
    );
  if (!location) throw new AppError("NOT_FOUND", "Location not found.");

  return db
    .select({
      tableId: diningTables.id,
      number: diningTables.number,
      name: diningTables.name,
      isActive: diningTables.isActive,
      token: qrTokens.token,
      lastScannedAt: qrTokens.lastScannedAt,
    })
    .from(diningTables)
    .leftJoin(qrTokens, and(eq(qrTokens.tableId, diningTables.id), isNull(qrTokens.revokedAt)))
    .where(
      and(eq(diningTables.restaurantId, restaurantId), eq(diningTables.locationId, locationId)),
    )
    .orderBy(asc(diningTables.sortOrder), asc(diningTables.createdAt));
}

/** Give every active table of a location a QR token. Returns how many were created. */
export async function ensureLocationQr(
  actor: Actor,
  restaurantId: string,
  locationId: string,
): Promise<number> {
  const tables = await listLocationQr(actor, restaurantId, locationId);
  let created = 0;
  for (const table of tables) {
    if (table.isActive && !table.token) {
      await ensureTableQr(actor, restaurantId, table.tableId);
      created++;
    }
  }
  return created;
}

export interface ResolvedQr {
  qrTokenId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  locationId: string;
  locationName: string;
  tableId: string;
  tableNumber: string;
}

/**
 * Public: what a scanned code points to (§13). Returns null — never an error
 * that says why — if the token is unknown, revoked or expired, or if the
 * table, location or restaurant isn't active. Revoked tokens can never
 * resolve, so they can't start a session (§49 #6).
 */
export async function resolveQrToken(token: string, now = new Date()): Promise<ResolvedQr | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db
    .select({
      qrId: qrTokens.id,
      restaurantId: restaurants.id,
      restaurantName: restaurants.name,
      restaurantSlug: restaurants.slug,
      locationId: restaurantLocations.id,
      locationName: restaurantLocations.name,
      tableId: diningTables.id,
      tableNumber: diningTables.number,
    })
    .from(qrTokens)
    .innerJoin(diningTables, eq(diningTables.id, qrTokens.tableId))
    .innerJoin(restaurantLocations, eq(restaurantLocations.id, diningTables.locationId))
    .innerJoin(restaurants, eq(restaurants.id, qrTokens.restaurantId))
    .where(
      and(
        eq(qrTokens.token, token),
        isNull(qrTokens.revokedAt),
        or(isNull(qrTokens.expiresAt), gt(qrTokens.expiresAt, now)),
        eq(diningTables.isActive, true),
        eq(restaurantLocations.status, "active"),
        eq(restaurants.status, "active"),
      ),
    );
  if (!row) return null;

  await db
    .update(qrTokens)
    .set({ lastScannedAt: now })
    .where(
      and(
        eq(qrTokens.id, row.qrId),
        or(
          isNull(qrTokens.lastScannedAt),
          lt(
            qrTokens.lastScannedAt,
            sql`${now.toISOString()}::timestamptz - ${SCAN_TOUCH_INTERVAL}`,
          ),
        ),
      ),
    );
  return {
    qrTokenId: row.qrId,
    restaurantId: row.restaurantId,
    restaurantName: row.restaurantName,
    restaurantSlug: row.restaurantSlug,
    locationId: row.locationId,
    locationName: row.locationName,
    tableId: row.tableId,
    tableNumber: row.tableNumber,
  };
}
