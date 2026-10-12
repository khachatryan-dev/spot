import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import {
  diningTables,
  orderItemModifiers,
  orderItems,
  orderNumberCounters,
  orders,
  orderStatusHistory,
  tableSessionMembers,
  tableSessions,
} from "@/server/db/schema";
import { publishOrderEvent } from "@/server/events/order-events";
import type { Customer } from "@/server/guests/current-customer";
import { priceOrderRequest } from "@/server/orders/catalog";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { hitRateLimit } from "@/server/rate-limit/rate-limit";
import { roleHasPermission } from "@/shared/auth/permissions";
import { ORDER_STATUSES, type OrderStatus } from "@/shared/constants/orders";
import { CUSTOMER_CANCELLABLE, findTransition } from "@/shared/domain/order-status";
import { AppError } from "@/shared/errors";
import type { OrderRequest } from "@/shared/schemas/order";

import { isBillLocked, lockVisitBilling } from "./bill-service";
import { queueOrderForPos } from "./pos-service";
import { getCustomerTableSession } from "./table-session-service";

/** Per table visit; stops scripted order spam without bothering real guests. */
const ORDER_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };

export interface PlacedOrder {
  id: string;
  number: number;
  status: OrderStatus;
  totalMinor: number;
  currency: string;
}

const placed = (o: typeof orders.$inferSelect): PlacedOrder => ({
  id: o.id,
  number: o.number,
  status: o.status,
  totalMinor: o.totalMinor,
  currency: o.currency,
});

async function findByIdempotencyKey(sessionId: string, key: string) {
  const [existing] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.tableSessionId, sessionId), eq(orders.idempotencyKey, key)));
  return existing ?? null;
}

/**
 * Place an order from a table (§16). Steps:
 *  1–3  the customer is a current member of an open session at an active
 *       table of a live restaurant;
 *  4–7  items and options are validated and priced from the database only;
 *  8    promotions: none yet;
 *  9–10 order, lines, option snapshots and first status entry are written
 *       in one transaction with the next order number;
 *  11   ORDER_CREATED is published after commit.
 * The same idempotency key always returns the same order.
 */
export async function createOrder(
  customer: Customer,
  sessionId: string | undefined,
  input: OrderRequest,
  now = new Date(),
): Promise<PlacedOrder> {
  // 1–3. Customer, restaurant and table session.
  const session = await getCustomerTableSession(customer, sessionId, now);
  if (!session)
    throw new AppError("NOT_FOUND", "Your table visit has ended. Scan the QR code again.");

  // Retries of the same checkout return the order that was already created.
  const key = typeof input?.idempotencyKey === "string" ? input.idempotencyKey : "";
  const repeat = key ? await findByIdempotencyKey(session.sessionId, key) : null;
  if (repeat) return placed(repeat);

  const [table] = await db
    .select({ isActive: diningTables.isActive })
    .from(diningTables)
    .where(eq(diningTables.id, session.table.id));
  if (!table?.isActive)
    throw new AppError("ORDER_UNAVAILABLE", "This table isn't taking orders right now.");

  if (!(await hitRateLimit(`order:${session.sessionId}`, ORDER_LIMIT)).allowed) {
    throw new AppError("RATE_LIMITED", "Too many orders. Please ask a staff member.");
  }

  // 4–8. Validate and price from the live catalog (never from the request).
  const { request, priced } = await priceOrderRequest(
    session.restaurant.id,
    session.location.id,
    input,
    now,
  );

  const [member] = await db
    .select({ id: tableSessionMembers.id })
    .from(tableSessionMembers)
    .where(
      and(
        eq(tableSessionMembers.sessionId, session.sessionId),
        customer.type === "user"
          ? eq(tableSessionMembers.userId, customer.user.id)
          : eq(tableSessionMembers.guestId, customer.guest.id),
        isNull(tableSessionMembers.leftAt),
      ),
    );

  // 9–10. One transaction: number, order, lines, snapshots, history.
  let order: typeof orders.$inferSelect;
  try {
    order = await db.transaction(async (tx) => {
      // Same lock as finalizing the bill: an order lands on the bill, or is refused.
      await lockVisitBilling(tx, session.sessionId);
      if (await isBillLocked(tx, session.sessionId)) {
        throw new AppError(
          "ORDER_UNAVAILABLE",
          "The bill for this table is ready. Ask a staff member to add more.",
        );
      }
      const [counter] = await tx
        .insert(orderNumberCounters)
        .values({ restaurantId: session.restaurant.id, lastNumber: 1 })
        .onConflictDoUpdate({
          target: orderNumberCounters.restaurantId,
          set: { lastNumber: sql`${orderNumberCounters.lastNumber} + 1` },
        })
        .returning({ number: orderNumberCounters.lastNumber });

      const [created] = await tx
        .insert(orders)
        .values({
          restaurantId: session.restaurant.id,
          locationId: session.location.id,
          tableId: session.table.id,
          tableSessionId: session.sessionId,
          memberId: member?.id ?? null,
          number: counter!.number,
          currency: session.restaurant.currency,
          subtotalMinor: priced.subtotalMinor,
          discountMinor: priced.discountMinor,
          totalMinor: priced.totalMinor,
          note: request.note || null,
          idempotencyKey: request.idempotencyKey,
          submittedAt: now,
        })
        .returning();

      for (const line of priced.lines) {
        const [item] = await tx
          .insert(orderItems)
          .values({
            restaurantId: session.restaurant.id,
            orderId: created!.id,
            menuItemId: line.menuItemId,
            name: line.name,
            unitPriceMinor: line.unitPriceMinor,
            modifiersTotalMinor: line.modifiersTotalMinor,
            quantity: line.quantity,
            lineTotalMinor: line.lineTotalMinor,
            note: line.note,
          })
          .returning({ id: orderItems.id });
        if (line.modifiers.length > 0) {
          await tx.insert(orderItemModifiers).values(
            line.modifiers.map((m) => ({
              ...m,
              restaurantId: session.restaurant.id,
              orderItemId: item!.id,
            })),
          );
        }
      }

      await tx.insert(orderStatusHistory).values({
        restaurantId: session.restaurant.id,
        orderId: created!.id,
        fromStatus: null,
        toStatus: "submitted",
        changedAt: now,
      });
      await tx
        .update(tableSessions)
        .set({ lastActivityAt: now })
        .where(eq(tableSessions.id, session.sessionId));
      return created!;
    });
  } catch (error) {
    // Two identical submissions raced: the other one won — return its order.
    if (isUniqueViolation(error, "orders_session_idempotency_unique")) {
      const existing = await findByIdempotencyKey(session.sessionId, request.idempotencyKey);
      if (existing) return placed(existing);
    }
    throw error;
  }

  // 11. Tell the restaurant (realtime delivery arrives on Day 47).
  await publishOrderEvent({
    type: "ORDER_CREATED",
    restaurantId: order.restaurantId,
    locationId: order.locationId,
    tableSessionId: order.tableSessionId,
    orderId: order.id,
    number: order.number,
  });
  await queueOrderForPos(order.id, "order_created");
  return placed(order);
}

export interface CustomerOrder {
  id: string;
  number: number;
  status: OrderStatus;
  submittedAt: Date;
  totalMinor: number;
  currency: string;
  note: string | null;
  /** Shown to the guest when the restaurant rejects or cancels. */
  cancelReason: string | null;
  lines: {
    id: string;
    name: string;
    quantity: number;
    lineTotalMinor: number;
    note: string | null;
    options: string[];
  }[];
}

/**
 * The customer's own orders in their current table visit, newest first.
 * Other people at the same table don't see each other's orders.
 */
export async function getCustomerOrders(
  customer: Customer,
  sessionId: string | undefined,
  now = new Date(),
): Promise<CustomerOrder[] | null> {
  const session = await getCustomerTableSession(customer, sessionId, now);
  if (!session) return null;
  const [member] = await db
    .select({ id: tableSessionMembers.id })
    .from(tableSessionMembers)
    .where(
      and(
        eq(tableSessionMembers.sessionId, session.sessionId),
        customer.type === "user"
          ? eq(tableSessionMembers.userId, customer.user.id)
          : eq(tableSessionMembers.guestId, customer.guest.id),
      ),
    );
  if (!member) return [];

  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.tableSessionId, session.sessionId), eq(orders.memberId, member.id)))
    .orderBy(desc(orders.submittedAt));
  if (rows.length === 0) return [];

  const ids = rows.map((o) => o.id);
  const items = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, ids))
    .orderBy(asc(orderItems.createdAt));
  const mods = items.length
    ? await db
        .select()
        .from(orderItemModifiers)
        .where(
          inArray(
            orderItemModifiers.orderItemId,
            items.map((i) => i.id),
          ),
        )
    : [];

  return rows.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    submittedAt: o.submittedAt,
    totalMinor: o.totalMinor,
    currency: o.currency,
    note: o.note,
    cancelReason: o.cancelReason,
    lines: items
      .filter((i) => i.orderId === o.id)
      .map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        lineTotalMinor: i.lineTotalMinor,
        note: i.note,
        options: mods.filter((m) => m.orderItemId === i.id).map((m) => m.name),
      })),
  }));
}

export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  "submitted",
  "received",
  "accepted",
  "preparing",
  "ready",
  "served",
];
export const FINISHED_ORDER_STATUSES: OrderStatus[] = ["completed", "cancelled", "rejected"];

export interface StaffOrder {
  id: string;
  number: number;
  status: OrderStatus;
  tableNumber: string;
  submittedAt: Date;
  totalMinor: number;
  currency: string;
  note: string | null;
  lines: { id: string; name: string; quantity: number; note: string | null; options: string[] }[];
}

/**
 * Orders at one location for staff (§17: no customer details, just what to
 * make and where). `finished` = completed/cancelled/rejected in the last 24
 * hours (or since `since`).
 */
export async function listOrdersForStaff(
  actor: Pick<SessionUser, "id">,
  restaurantId: string,
  locationId: string,
  options: { finished?: boolean; since?: Date; limit?: number } = {},
): Promise<StaffOrder[]> {
  await authorizeRestaurant(actor.id, restaurantId, "order:read");
  if (!z.uuid().safeParse(locationId).success)
    throw new AppError("NOT_FOUND", "Location not found.");

  const statuses = options.finished ? FINISHED_ORDER_STATUSES : ACTIVE_ORDER_STATUSES;
  const since =
    options.since ?? (options.finished ? new Date(Date.now() - 24 * 60 * 60 * 1000) : undefined);
  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      tableNumber: diningTables.number,
      submittedAt: orders.submittedAt,
      totalMinor: orders.totalMinor,
      currency: orders.currency,
      note: orders.note,
    })
    .from(orders)
    .innerJoin(diningTables, eq(diningTables.id, orders.tableId))
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.locationId, locationId),
        inArray(orders.status, statuses),
        since ? gte(orders.submittedAt, since) : undefined,
      ),
    )
    // Oldest open orders first (they've waited longest); finished ones newest first.
    .orderBy(options.finished ? desc(orders.submittedAt) : asc(orders.submittedAt))
    .limit(Math.min(options.limit ?? 200, 500));
  if (rows.length === 0) return [];

  const items = await db
    .select()
    .from(orderItems)
    .where(
      inArray(
        orderItems.orderId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(orderItems.createdAt));
  const mods = items.length
    ? await db
        .select()
        .from(orderItemModifiers)
        .where(
          inArray(
            orderItemModifiers.orderItemId,
            items.map((i) => i.id),
          ),
        )
    : [];

  return rows.map((row) => ({
    ...row,
    lines: items
      .filter((i) => i.orderId === row.id)
      .map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        note: i.note,
        options: mods.filter((m) => m.orderItemId === i.id).map((m) => m.name),
      })),
  }));
}

const STATUS_TIMESTAMP: Partial<
  Record<OrderStatus, "acceptedAt" | "readyAt" | "servedAt" | "completedAt" | "cancelledAt">
> = {
  accepted: "acceptedAt",
  ready: "readyAt",
  served: "servedAt",
  completed: "completedAt",
  cancelled: "cancelledAt",
  rejected: "cancelledAt",
};

const reasonSchema = z.string().trim().min(3, "reasonTooShort").max(300, "reasonTooLong");

/**
 * Move an order to its next status, in one transaction with its history
 * entry. The order row is locked, so two staff tapping at once can't both
 * succeed; the loser gets CONFLICT.
 */
async function applyStatusChange(
  restaurantId: string,
  orderId: string,
  to: OrderStatus,
  check: (from: OrderStatus) => void,
  { changedByUserId, reason, now }: { changedByUserId: string | null; reason?: string; now: Date },
) {
  const changed = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.restaurantId, restaurantId)))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND", "Order not found.");
    check(current.status);

    const timestamp = STATUS_TIMESTAMP[to];
    const [updated] = await tx
      .update(orders)
      .set({
        status: to,
        ...(timestamp ? { [timestamp]: now } : {}),
        ...(to === "cancelled" || to === "rejected" ? { cancelReason: reason ?? null } : {}),
      })
      .where(eq(orders.id, orderId))
      .returning();
    await tx.insert(orderStatusHistory).values({
      restaurantId,
      orderId,
      fromStatus: current.status,
      toStatus: to,
      changedByUserId,
      note: reason ?? null,
      changedAt: now,
    });
    await tx
      .update(tableSessions)
      .set({ lastActivityAt: now })
      .where(eq(tableSessions.id, current.tableSessionId));
    return updated!;
  });

  await publishOrderEvent({
    type: "ORDER_STATUS_CHANGED",
    restaurantId: changed.restaurantId,
    locationId: changed.locationId,
    tableSessionId: changed.tableSessionId,
    orderId: changed.id,
    status: changed.status,
  });
  await queueOrderForPos(changed.id, "order_updated");
  return changed;
}

/** Staff change an order's status, following the rules in order-status.ts. */
export async function changeOrderStatus(
  actor: Pick<SessionUser, "id">,
  restaurantId: string,
  orderId: string,
  to: OrderStatus,
  options: { reason?: string } = {},
  now = new Date(),
) {
  const access = await authorizeRestaurant(actor.id, restaurantId, "order:read");
  if (!z.uuid().safeParse(orderId).success) throw new AppError("NOT_FOUND", "Order not found.");
  const target = z.enum(ORDER_STATUSES).parse(to);

  return applyStatusChange(
    restaurantId,
    orderId,
    target,
    (from) => {
      const step = findTransition(from, target);
      if (!step) throw new AppError("CONFLICT", `This order is already ${from}.`);
      if (!step.permissions.some((p) => roleHasPermission(access.role, p)))
        throw new AppError("FORBIDDEN");
      if (step.reasonRequired) reasonSchema.parse(options.reason ?? "");
    },
    { changedByUserId: actor.id, reason: options.reason?.trim(), now },
  );
}

/** A guest cancels their own order — only before the kitchen accepts it. */
export async function cancelOrderAsCustomer(
  customer: Customer,
  sessionId: string | undefined,
  orderId: string,
  now = new Date(),
) {
  const mine = await getCustomerOrders(customer, sessionId, now);
  const order = mine?.find((o) => o.id === orderId);
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  const session = await getCustomerTableSession(customer, sessionId, now);

  return applyStatusChange(
    session!.restaurant.id,
    orderId,
    "cancelled",
    (from) => {
      if (!CUSTOMER_CANCELLABLE.includes(from)) {
        throw new AppError("CONFLICT", "The kitchen has already started on this order.");
      }
    },
    { changedByUserId: null, reason: "Cancelled by the guest", now },
  );
}

/** What the kitchen needs and nothing more (§17): no prices, no customer details. */
export interface KitchenOrder {
  id: string;
  number: number;
  status: OrderStatus;
  tableNumber: string;
  submittedAt: Date;
  note: string | null;
  lines: { id: string; name: string; quantity: number; note: string | null; options: string[] }[];
}

export const KITCHEN_QUEUE_STATUSES: OrderStatus[] = [
  "submitted",
  "received",
  "accepted",
  "preparing",
];

/** The kitchen's queue (oldest first) plus orders ready for pickup. */
export async function listKitchenOrders(
  actor: Pick<SessionUser, "id">,
  restaurantId: string,
  locationId: string,
): Promise<{ queue: KitchenOrder[]; ready: KitchenOrder[] }> {
  await authorizeRestaurant(actor.id, restaurantId, "order:prepare");
  const all = await listOrdersForStaff(actor, restaurantId, locationId);
  // Drop money fields explicitly — they must never reach the kitchen screen.
  const strip = ({
    id,
    number,
    status,
    tableNumber,
    submittedAt,
    note,
    lines,
  }: StaffOrder): KitchenOrder => ({
    id,
    number,
    status,
    tableNumber,
    submittedAt,
    note,
    lines,
  });
  return {
    queue: all.filter((o) => KITCHEN_QUEUE_STATUSES.includes(o.status)).map(strip),
    ready: all.filter((o) => o.status === "ready").map(strip),
  };
}
