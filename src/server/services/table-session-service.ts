import "server-only";

import { and, asc, count, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import {
  diningTables,
  restaurantLocations,
  restaurants,
  type TableSession,
  tableSessionMembers,
  tableSessions,
} from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { generateSessionCode } from "@/server/table-sessions/session-code";
import { TABLE_SESSION_IDLE_HOURS } from "@/shared/constants/table-sessions";
import { AppError } from "@/shared/errors";

import type { ResolvedQr } from "./qr-service";

/*
 * Table sessions (§14): a scan joins the table's open session or starts one.
 * Access to a session always requires being one of its members.
 */

const IDLE_MS = TABLE_SESSION_IDLE_HOURS * 60 * 60 * 1000;

const memberIdentity = (customer: Customer) =>
  customer.type === "user" ? { userId: customer.user.id } : { guestId: customer.guest.id };

const isMember = (customer: Customer) =>
  customer.type === "user"
    ? eq(tableSessionMembers.userId, customer.user.id)
    : eq(tableSessionMembers.guestId, customer.guest.id);

/**
 * Join the open session at the scanned table, or start one. A session idle
 * for longer than TABLE_SESSION_IDLE_HOURS is closed as expired first, so the
 * next day's guests never land in last night's visit.
 */
export async function joinTableSession(
  customer: Customer,
  qr: ResolvedQr,
  now = new Date(),
): Promise<TableSession> {
  return db.transaction(async (tx) => {
    // Serialize joins per table so two simultaneous scans share one session.
    await tx
      .select({ id: diningTables.id })
      .from(diningTables)
      .where(and(eq(diningTables.id, qr.tableId), eq(diningTables.restaurantId, qr.restaurantId)))
      .for("update");

    let [session] = await tx
      .select()
      .from(tableSessions)
      .where(and(eq(tableSessions.tableId, qr.tableId), eq(tableSessions.status, "open")));

    if (session && now.getTime() - session.lastActivityAt.getTime() > IDLE_MS) {
      await tx
        .update(tableSessions)
        .set({ status: "closed", closedAt: now, closedReason: "expired" })
        .where(eq(tableSessions.id, session.id));
      session = undefined;
    }

    if (!session) {
      [session] = await tx
        .insert(tableSessions)
        .values({
          restaurantId: qr.restaurantId,
          tableId: qr.tableId,
          code: generateSessionCode(),
          openedViaQrTokenId: qr.qrTokenId,
          lastActivityAt: now,
        })
        .returning();
    } else {
      await tx
        .update(tableSessions)
        .set({ lastActivityAt: now })
        .where(eq(tableSessions.id, session.id));
    }

    const identity = memberIdentity(customer);
    await tx
      .insert(tableSessionMembers)
      .values({ sessionId: session!.id, ...identity, joinedAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target:
          customer.type === "user"
            ? [tableSessionMembers.sessionId, tableSessionMembers.userId]
            : [tableSessionMembers.sessionId, tableSessionMembers.guestId],
        targetWhere:
          customer.type === "user"
            ? sql`${tableSessionMembers.userId} IS NOT NULL`
            : sql`${tableSessionMembers.guestId} IS NOT NULL`,
        // Scanning again after leaving rejoins the visit.
        set: { lastSeenAt: now, leftAt: null },
      });
    return session!;
  });
}

export interface CustomerTableSession {
  sessionId: string;
  /** This customer's membership in the visit (who ordered what, §23). */
  memberId: string;
  code: string;
  restaurant: { id: string; name: string; slug: string; currency: string };
  location: { id: string; name: string };
  table: { id: string; number: string };
}

/**
 * The open session `sessionId` — only if this customer is a member and it
 * hasn't gone idle. Knowing a session id alone grants nothing.
 */
export async function getCustomerTableSession(
  customer: Customer,
  sessionId: string | undefined,
  now = new Date(),
): Promise<CustomerTableSession | null> {
  if (!sessionId || !z.uuid().safeParse(sessionId).success) return null;
  const [row] = await db
    .select({
      sessionId: tableSessions.id,
      memberId: tableSessionMembers.id,
      code: tableSessions.code,
      restaurant: {
        id: restaurants.id,
        name: restaurants.name,
        slug: restaurants.slug,
        currency: restaurants.currency,
      },
      location: { id: restaurantLocations.id, name: restaurantLocations.name },
      table: { id: diningTables.id, number: diningTables.number },
    })
    .from(tableSessions)
    .innerJoin(tableSessionMembers, eq(tableSessionMembers.sessionId, tableSessions.id))
    .innerJoin(diningTables, eq(diningTables.id, tableSessions.tableId))
    .innerJoin(restaurantLocations, eq(restaurantLocations.id, diningTables.locationId))
    .innerJoin(restaurants, eq(restaurants.id, tableSessions.restaurantId))
    .where(
      and(
        eq(tableSessions.id, sessionId),
        eq(tableSessions.status, "open"),
        gt(tableSessions.lastActivityAt, new Date(now.getTime() - IDLE_MS)),
        isMember(customer),
        isNull(tableSessionMembers.leftAt),
        eq(restaurants.status, "active"),
      ),
    );
  return row ?? null;
}

/** Close idle sessions in bulk (for a scheduled job; joins also handle it lazily). */
export async function closeIdleTableSessions(now = new Date()) {
  const closed = await db
    .update(tableSessions)
    .set({ status: "closed", closedAt: now, closedReason: "expired" })
    .where(
      and(
        eq(tableSessions.status, "open"),
        lt(tableSessions.lastActivityAt, new Date(now.getTime() - IDLE_MS)),
      ),
    )
    .returning({ id: tableSessions.id });
  return closed.length;
}

/** The customer leaves the visit; scanning again rejoins it. */
export async function leaveTableSession(customer: Customer, sessionId: string, now = new Date()) {
  if (!z.uuid().safeParse(sessionId).success) return;
  await db
    .update(tableSessionMembers)
    .set({ leftAt: now })
    .where(
      and(
        eq(tableSessionMembers.sessionId, sessionId),
        isMember(customer),
        isNull(tableSessionMembers.leftAt),
      ),
    );
}

type Actor = Pick<SessionUser, "id">;

export interface ActiveTableSession {
  sessionId: string;
  tableId: string;
  code: string;
  openedAt: Date;
  lastActivityAt: Date;
  memberCount: number;
}

/** Open, non-idle sessions at a location's tables, for staff. */
export async function listActiveSessions(
  actor: Actor,
  restaurantId: string,
  locationId: string,
  now = new Date(),
): Promise<ActiveTableSession[]> {
  await authorizeRestaurant(actor.id, restaurantId, "table:read");
  if (!z.uuid().safeParse(locationId).success)
    throw new AppError("NOT_FOUND", "Location not found.");
  return db
    .select({
      sessionId: tableSessions.id,
      tableId: tableSessions.tableId,
      code: tableSessions.code,
      openedAt: tableSessions.createdAt,
      lastActivityAt: tableSessions.lastActivityAt,
      memberCount: count(tableSessionMembers.id),
    })
    .from(tableSessions)
    .innerJoin(diningTables, eq(diningTables.id, tableSessions.tableId))
    .leftJoin(
      tableSessionMembers,
      and(eq(tableSessionMembers.sessionId, tableSessions.id), isNull(tableSessionMembers.leftAt)),
    )
    .where(
      and(
        eq(tableSessions.restaurantId, restaurantId),
        eq(diningTables.locationId, locationId),
        eq(tableSessions.status, "open"),
        gt(tableSessions.lastActivityAt, new Date(now.getTime() - IDLE_MS)),
      ),
    )
    .groupBy(tableSessions.id)
    .orderBy(asc(tableSessions.createdAt));
}

/**
 * Staff end a visit (the table is free again). Its members lose access; the
 * next scan starts a new session.
 */
export async function closeTableSession(
  actor: Actor,
  restaurantId: string,
  sessionId: string,
  now = new Date(),
) {
  await authorizeRestaurant(actor.id, restaurantId, "table_session:close");
  if (!z.uuid().safeParse(sessionId).success) throw new AppError("NOT_FOUND", "Session not found.");
  await db.transaction(async (tx) => {
    const [closed] = await tx
      .update(tableSessions)
      .set({ status: "closed", closedAt: now, closedReason: "staff", closedByUserId: actor.id })
      .where(
        and(
          eq(tableSessions.id, sessionId),
          eq(tableSessions.restaurantId, restaurantId),
          eq(tableSessions.status, "open"),
        ),
      )
      .returning({
        id: tableSessions.id,
        code: tableSessions.code,
        tableId: tableSessions.tableId,
      });
    if (!closed) throw new AppError("NOT_FOUND", "Session not found or already closed.");
    await recordAudit(tx, {
      actor,
      action: "table_session.closed",
      entityType: "table_session",
      entityId: closed.id,
      restaurantId,
      metadata: { code: closed.code, tableId: closed.tableId },
    });
  });
}
