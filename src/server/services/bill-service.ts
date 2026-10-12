import "server-only";

import { and, asc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db, type Executor, type Transaction } from "@/server/db/client";
import {
  type Bill,
  type BillItem,
  type BillItemOption,
  billItems,
  billPayments,
  bills,
  diningTables,
  orderItemModifiers,
  orderItems,
  orders,
  restaurantLocations,
  restaurants,
  tableSessionMembers,
  tableSessions,
  users,
} from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { realtimeChannels } from "@/server/realtime/channels";
import { getRealtimePublisher } from "@/server/realtime/realtime";
import type { OrderStatus } from "@/shared/constants/orders";
import { billAmounts } from "@/shared/domain/bill-math";
import { AppError } from "@/shared/errors";

import { getCustomerTableSession } from "./table-session-service";

/*
 * Bills (§22). A visit's bill stays open while guests order: its lines are
 * rebuilt from the visit's orders (cancelled and rejected ones excluded)
 * whenever it's read. Finalizing locks the lines and amounts — service
 * charge and included VAT as configured at that moment — and stops further
 * ordering on the visit. Voiding (nothing paid) is the explicit correction:
 * the visit then gets a fresh bill.
 */

type Actor = Pick<SessionUser, "id">;

const NOT_BILLED: OrderStatus[] = ["cancelled", "rejected"];
/** Orders the kitchen hasn't answered yet: the bill can't be finalized around them. */
const AWAITING_KITCHEN: OrderStatus[] = ["submitted", "received"];

const voidReasonSchema = z.string().trim().min(3, "reasonTooShort").max(300, "reasonTooLong");

/**
 * Serialize finalizing a visit's bill with placing orders on that visit, so
 * an order either makes it onto the bill or is refused — never lost between.
 */
export async function lockVisitBilling(executor: Executor, sessionId: string) {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${sessionId}`}, 0))`,
  );
}

/** The visit's live (not voided) bill, locked, creating an open one if needed. */
async function lockLiveBill(tx: Transaction, sessionId: string): Promise<Bill> {
  const live = () =>
    tx
      .select()
      .from(bills)
      .where(and(eq(bills.tableSessionId, sessionId), ne(bills.status, "void")))
      .for("update");
  const [existing] = await live();
  if (existing) return existing;

  const [visit] = await tx
    .select({
      restaurantId: tableSessions.restaurantId,
      tableId: tableSessions.tableId,
      locationId: diningTables.locationId,
      currency: restaurants.currency,
    })
    .from(tableSessions)
    .innerJoin(diningTables, eq(diningTables.id, tableSessions.tableId))
    .innerJoin(restaurants, eq(restaurants.id, tableSessions.restaurantId))
    .where(eq(tableSessions.id, sessionId));
  if (!visit) throw new AppError("NOT_FOUND", "Table visit not found.");
  // Two readers may race to create it; the partial unique index keeps one.
  await tx
    .insert(bills)
    .values({ ...visit, tableSessionId: sessionId })
    .onConflictDoNothing();
  const [created] = await live();
  return created!;
}

/** Rebuild an open bill's lines and amounts from the visit's orders. */
async function syncBill(tx: Transaction, bill: Bill): Promise<Bill> {
  if (bill.status !== "open") return bill;

  const eligible = await tx
    .select({
      orderItemId: orderItems.id,
      memberId: orders.memberId,
      name: orderItems.name,
      unitPriceMinor: orderItems.unitPriceMinor,
      modifiersTotalMinor: orderItems.modifiersTotalMinor,
      quantity: orderItems.quantity,
      lineTotalMinor: orderItems.lineTotalMinor,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(eq(orders.tableSessionId, bill.tableSessionId), notInArray(orders.status, NOT_BILLED)),
    )
    .orderBy(asc(orders.submittedAt), asc(orderItems.createdAt));
  const existing = await tx
    .select({ id: billItems.id, orderItemId: billItems.orderItemId })
    .from(billItems)
    .where(eq(billItems.billId, bill.id));

  const wanted = new Set(eligible.map((e) => e.orderItemId));
  const stale = existing.filter((line) => !line.orderItemId || !wanted.has(line.orderItemId));
  if (stale.length > 0) {
    await tx.delete(billItems).where(
      inArray(
        billItems.id,
        stale.map((line) => line.id),
      ),
    );
  }
  const have = new Set(existing.map((line) => line.orderItemId));
  const missing = eligible.filter((e) => !have.has(e.orderItemId));
  if (missing.length > 0) {
    const options = await optionsFor(
      tx,
      missing.map((m) => m.orderItemId),
    );
    await tx.insert(billItems).values(
      missing.map((m) => ({
        ...m,
        restaurantId: bill.restaurantId,
        billId: bill.id,
        options: options.get(m.orderItemId) ?? [],
      })),
    );
  }

  const [rates] = await tx
    .select({
      serviceFeeBps: restaurantLocations.serviceFeeBps,
      vatRateBps: restaurants.vatRateBps,
    })
    .from(restaurantLocations)
    .innerJoin(restaurants, eq(restaurants.id, restaurantLocations.restaurantId))
    .where(eq(restaurantLocations.id, bill.locationId));
  const amounts = billAmounts({
    lineTotals: eligible.map((e) => e.lineTotalMinor),
    discountMinor: bill.discountMinor,
    serviceFeeBps: rates!.serviceFeeBps,
    vatRateBps: rates!.vatRateBps,
    currency: bill.currency,
  });
  const [updated] = await tx.update(bills).set(amounts).where(eq(bills.id, bill.id)).returning();
  return updated!;
}

async function optionsFor(executor: Executor, orderItemIds: string[]) {
  const rows = await executor
    .select({
      orderItemId: orderItemModifiers.orderItemId,
      group: orderItemModifiers.groupName,
      name: orderItemModifiers.name,
      priceDeltaMinor: orderItemModifiers.priceDeltaMinor,
    })
    .from(orderItemModifiers)
    .where(inArray(orderItemModifiers.orderItemId, orderItemIds));
  const byItem = new Map<string, BillItemOption[]>();
  for (const { orderItemId, ...option } of rows) {
    byItem.set(orderItemId, [...(byItem.get(orderItemId) ?? []), option]);
  }
  return byItem;
}

export interface BillView {
  bill: Bill;
  lines: BillItem[];
  tableNumber: string;
  /** Orders the kitchen hasn't accepted or rejected yet. */
  awaitingKitchen: number;
  /**
   * The visit's guests in joining order, for "who ordered what" (§23):
   * an account's name, or null for an anonymous guest ("Guest 2").
   */
  members: { id: string; name: string | null; position: number }[];
}

async function viewOf(tx: Transaction, bill: Bill): Promise<BillView> {
  const [lines, [table], waiting, members] = await Promise.all([
    tx
      .select()
      .from(billItems)
      .where(eq(billItems.billId, bill.id))
      .orderBy(asc(billItems.createdAt)),
    tx
      .select({ number: diningTables.number })
      .from(diningTables)
      .where(eq(diningTables.id, bill.tableId)),
    tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.tableSessionId, bill.tableSessionId),
          inArray(orders.status, AWAITING_KITCHEN),
        ),
      ),
    tx
      .select({ id: tableSessionMembers.id, name: users.name })
      .from(tableSessionMembers)
      .leftJoin(users, eq(users.id, tableSessionMembers.userId))
      .where(eq(tableSessionMembers.sessionId, bill.tableSessionId))
      .orderBy(asc(tableSessionMembers.joinedAt), asc(tableSessionMembers.id)),
  ]);
  return {
    bill,
    lines,
    tableNumber: table!.number,
    awaitingKitchen: waiting.length,
    members: members.map((m, i) => ({ id: m.id, name: m.name?.trim() || null, position: i + 1 })),
  };
}

async function staffVisit(
  actor: Actor,
  restaurantId: string,
  sessionId: string,
  permission: "bill:read" | "bill:manage",
) {
  await authorizeRestaurant(actor.id, restaurantId, permission);
  if (!z.uuid().safeParse(sessionId).success)
    throw new AppError("NOT_FOUND", "Table visit not found.");
  const [visit] = await db
    .select({ id: tableSessions.id })
    .from(tableSessions)
    .where(and(eq(tableSessions.id, sessionId), eq(tableSessions.restaurantId, restaurantId)));
  if (!visit) throw new AppError("NOT_FOUND", "Table visit not found.");
}

/** The visit's bill as staff see it (bill:read), up to date with its orders. */
export async function getBillForStaff(
  actor: Actor,
  restaurantId: string,
  sessionId: string,
): Promise<BillView> {
  await staffVisit(actor, restaurantId, sessionId, "bill:read");
  return db.transaction(async (tx) =>
    viewOf(tx, await syncBill(tx, await lockLiveBill(tx, sessionId))),
  );
}

/** The bill of the guest's current table visit (§22), or null if they're not at a table. */
export async function getBillForGuest(
  customer: Customer,
  sessionId: string | undefined,
): Promise<BillView | null> {
  const session = await getCustomerTableSession(customer, sessionId);
  if (!session) return null;
  return db.transaction(async (tx) =>
    viewOf(tx, await syncBill(tx, await lockLiveBill(tx, session.sessionId))),
  );
}

/** Lock the bill for payment (bill:manage): amounts, service charge and VAT are fixed. */
export async function finalizeBill(
  actor: Actor,
  restaurantId: string,
  sessionId: string,
): Promise<BillView> {
  await staffVisit(actor, restaurantId, sessionId, "bill:manage");
  const view = await db.transaction(async (tx) => {
    await lockVisitBilling(tx, sessionId);
    const bill = await syncBill(tx, await lockLiveBill(tx, sessionId));
    if (bill.status !== "open") throw new AppError("CONFLICT", "This bill is already finalized.");
    const current = await viewOf(tx, bill);
    if (current.lines.length === 0) throw new AppError("CONFLICT", "There's nothing to bill yet.");
    if (current.awaitingKitchen > 0) {
      throw new AppError("CONFLICT", "Some orders are still waiting for the kitchen's answer.");
    }
    const [finalized] = await tx
      .update(bills)
      .set({ status: "finalized", finalizedAt: new Date(), finalizedByUserId: actor.id })
      .where(eq(bills.id, bill.id))
      .returning();
    await recordAudit(tx, {
      actor,
      action: "bill.finalized",
      entityType: "bill",
      entityId: bill.id,
      restaurantId,
      metadata: { totalMinor: bill.totalMinor, serviceFeeMinor: bill.serviceFeeMinor },
    });
    return { ...current, bill: finalized! };
  });
  await publishBillChanged(view.bill);
  return view;
}

/** Cancel a bill nobody has paid anything on (bill:manage); the visit gets a fresh one. */
export async function voidBill(
  actor: Actor,
  restaurantId: string,
  billId: string,
  reason: string,
): Promise<Bill> {
  await authorizeRestaurant(actor.id, restaurantId, "bill:manage");
  const why = voidReasonSchema.parse(reason);
  if (!z.uuid().safeParse(billId).success) throw new AppError("NOT_FOUND", "Bill not found.");
  const voided = await db.transaction(async (tx) => {
    const [bill] = await tx
      .select()
      .from(bills)
      .where(and(eq(bills.id, billId), eq(bills.restaurantId, restaurantId)))
      .for("update");
    if (!bill) throw new AppError("NOT_FOUND", "Bill not found.");
    // Paid money, or an online payment still in progress, keeps the bill.
    const [live] = await tx
      .select({ id: billPayments.id })
      .from(billPayments)
      .where(
        and(
          eq(billPayments.billId, bill.id),
          inArray(billPayments.status, ["pending", "succeeded"]),
        ),
      )
      .limit(1);
    if (bill.status === "paid" || bill.status === "void" || bill.paidMinor > 0 || live) {
      throw new AppError("CONFLICT", "A bill with payments on it can't be voided.");
    }
    const [voided] = await tx
      .update(bills)
      .set({ status: "void", voidedAt: new Date(), voidReason: why })
      .where(eq(bills.id, bill.id))
      .returning();
    await recordAudit(tx, {
      actor,
      action: "bill.voided",
      entityType: "bill",
      entityId: bill.id,
      restaurantId,
      metadata: { reason: why, totalMinor: bill.totalMinor, from: bill.status },
    });
    return voided!;
  });
  await publishBillChanged(voided);
  return voided;
}

/** Can the visit still order? Not once its bill is finalized (or paid). */
export async function isBillLocked(executor: Executor, sessionId: string): Promise<boolean> {
  const [locked] = await executor
    .select({ id: bills.id })
    .from(bills)
    .where(and(eq(bills.tableSessionId, sessionId), inArray(bills.status, ["finalized", "paid"])));
  return !!locked;
}

/** Tell the table's guests and the location's staff to look again (no amounts sent, §28). */
async function publishBillChanged(bill: Bill) {
  const publisher = getRealtimePublisher();
  const hint = { type: "BILL_CHANGED", id: bill.id, status: bill.status };
  await Promise.all([
    publisher.publish(realtimeChannels.location(bill.restaurantId, bill.locationId), hint),
    publisher.publish(realtimeChannels.session(bill.tableSessionId), hint),
  ]);
}
