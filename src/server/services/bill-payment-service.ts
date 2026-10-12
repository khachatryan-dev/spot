import "server-only";

import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db, type Transaction } from "@/server/db/client";
import {
  type Bill,
  type BillPayment,
  billItems,
  billPaymentItems,
  billPayments,
  bills,
  type Payment,
} from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { logger } from "@/server/logger";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { realtimeChannels } from "@/server/realtime/channels";
import { getRealtimePublisher } from "@/server/realtime/realtime";
import { clientEnv } from "@/shared/config/env.client";
import {
  BILL_PAYMENT_HOLD_MINUTES,
  type BillPaymentMethod,
  MAX_SPLIT_WAYS,
} from "@/shared/constants/bills";
import { equalShare, itemsAmount } from "@/shared/domain/bill-split";
import { AppError } from "@/shared/errors";

import { startPayment } from "./payment-service";
import { queueBillClosedForPos } from "./pos-service";
import { refundPaymentAutomatically } from "./refund-service";
import { getCustomerTableSession } from "./table-session-service";

/*
 * Paying a finalized bill, whole or split (§23): an equal share, chosen
 * lines (e.g. "my own items"), or whatever is left. The server works out
 * every amount from the bill. Each payment locks the bill row, releases
 * timed-out online attempts, checks what's still free and reserves it in
 * the same transaction — so a share, a line or a dram can't be paid twice
 * (unique indexes back this up). Online payments settle through the
 * provider; cash and card-terminal payments are recorded by staff.
 */

type Actor = Pick<SessionUser, "id">;
const log = logger.child({ module: "bill-payments" });

const requestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("equal"),
    shareCount: z.number().int().min(2).max(MAX_SPLIT_WAYS),
    shareIndex: z.number().int().min(1),
  }),
  z.object({ mode: z.literal("items"), itemIds: z.array(z.uuid()).min(1).max(200) }),
  z.object({ mode: z.literal("full") }),
]);

export type BillPaymentRequest = z.input<typeof requestSchema>;

/** Who is paying and how. */
type Payer =
  | { kind: "guest"; memberId: string }
  | { kind: "staff"; actor: Actor; method: Exclude<BillPaymentMethod, "online"> };

/** What's already paid or reserved on a bill (live payments only). */
export interface BillPaymentState {
  paidMinor: number;
  /** Paid plus reserved by unfinished online payments. */
  heldMinor: number;
  remainingMinor: number;
  /** The equal split in use, if any: share count and the shares taken. */
  split: { count: number; taken: number[] } | null;
  usesItems: boolean;
  /** Lines covered by a live payment. */
  coveredItemIds: string[];
}

async function releaseExpired(tx: Transaction, billId: string, now: Date) {
  const expired = await tx
    .update(billPayments)
    .set({ status: "expired" })
    .where(
      and(
        eq(billPayments.billId, billId),
        eq(billPayments.status, "pending"),
        lte(billPayments.expiresAt, now),
      ),
    )
    .returning({ id: billPayments.id });
  if (expired.length > 0) {
    await tx
      .update(billPaymentItems)
      .set({ active: false })
      .where(
        inArray(
          billPaymentItems.billPaymentId,
          expired.map((p) => p.id),
        ),
      );
  }
}

async function stateOf(tx: Transaction, bill: Bill): Promise<BillPaymentState> {
  const live = await tx
    .select()
    .from(billPayments)
    .where(
      and(eq(billPayments.billId, bill.id), inArray(billPayments.status, ["pending", "succeeded"])),
    );
  const covered = await tx
    .select({ billItemId: billPaymentItems.billItemId })
    .from(billPaymentItems)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentItems.billPaymentId))
    .where(and(eq(billPayments.billId, bill.id), eq(billPaymentItems.active, true)));
  const heldMinor = live.reduce((sum, p) => sum + p.amountMinor, 0);
  const equal = live.filter((p) => p.mode === "equal");
  return {
    paidMinor: bill.paidMinor,
    heldMinor,
    remainingMinor: bill.totalMinor - heldMinor,
    split:
      equal.length > 0
        ? {
            count: equal[0]!.shareCount!,
            taken: equal.map((p) => p.shareIndex!).sort((a, b) => a - b),
          }
        : null,
    usesItems: live.some((p) => p.mode === "items"),
    coveredItemIds: covered.map((c) => c.billItemId),
  };
}

async function lockBill(tx: Transaction, where: ReturnType<typeof and>) {
  const [bill] = await tx.select().from(bills).where(where).for("update");
  if (!bill) throw new AppError("NOT_FOUND", "Bill not found.");
  return bill;
}

/** Work out and reserve a payment on a locked bill. */
async function reserve(
  tx: Transaction,
  bill: Bill,
  request: z.output<typeof requestSchema>,
  payer: Payer,
  now: Date,
): Promise<BillPayment> {
  if (bill.status !== "finalized") {
    throw new AppError(
      "CONFLICT",
      bill.status === "paid" ? "This bill is already paid." : "This bill isn't ready to pay yet.",
    );
  }
  await releaseExpired(tx, bill.id, now);
  const state = await stateOf(tx, bill);

  let amountMinor: number;
  let itemIds: string[] = [];
  if (request.mode === "equal") {
    if (state.usesItems) throw new AppError("CONFLICT", "This bill is being paid by items.");
    if (state.split && state.split.count !== request.shareCount) {
      throw new AppError("CONFLICT", `This bill is split ${state.split.count} ways.`);
    }
    if (
      request.shareIndex > request.shareCount ||
      state.split?.taken.includes(request.shareIndex)
    ) {
      throw new AppError("CONFLICT", "That share is already paid or being paid.");
    }
    amountMinor = equalShare(
      bill.totalMinor,
      request.shareCount,
      request.shareIndex,
      bill.currency,
    );
  } else if (request.mode === "items") {
    if (state.split) throw new AppError("CONFLICT", "This bill is being split equally.");
    const lines = await tx.select().from(billItems).where(eq(billItems.billId, bill.id));
    const chosen = lines.filter((l) => request.itemIds.includes(l.id));
    if (chosen.length !== new Set(request.itemIds).size) {
      throw new AppError("NOT_FOUND", "Some items aren't on this bill.");
    }
    if (chosen.some((l) => state.coveredItemIds.includes(l.id))) {
      throw new AppError("CONFLICT", "Some of these items are already paid or being paid.");
    }
    const uncovered = lines.filter((l) => !state.coveredItemIds.includes(l.id));
    amountMinor = itemsAmount({
      linesMinor: chosen.reduce((sum, l) => sum + l.lineTotalMinor, 0),
      subtotalMinor: bill.subtotalMinor,
      totalMinor: bill.totalMinor,
      heldMinor: state.heldMinor,
      isLast: uncovered.length === chosen.length,
      currency: bill.currency,
    });
    itemIds = chosen.map((l) => l.id);
  } else {
    amountMinor = state.remainingMinor;
  }
  if (amountMinor <= 0 || amountMinor > state.remainingMinor) {
    throw new AppError("CONFLICT", "There's nothing left to pay for that.");
  }

  const staff = payer.kind === "staff";
  const [payment] = await tx
    .insert(billPayments)
    .values({
      restaurantId: bill.restaurantId,
      billId: bill.id,
      mode: request.mode,
      shareIndex: request.mode === "equal" ? request.shareIndex : null,
      shareCount: request.mode === "equal" ? request.shareCount : null,
      amountMinor,
      method: staff ? payer.method : "online",
      status: staff ? "succeeded" : "pending",
      memberId: staff ? null : payer.memberId,
      recordedByUserId: staff ? payer.actor.id : null,
      expiresAt: staff ? null : new Date(now.getTime() + BILL_PAYMENT_HOLD_MINUTES * 60_000),
      settledAt: staff ? now : null,
    })
    .returning();
  if (itemIds.length > 0) {
    await tx.insert(billPaymentItems).values(
      itemIds.map((billItemId) => ({
        restaurantId: bill.restaurantId,
        billPaymentId: payment!.id,
        billItemId,
      })),
    );
  }
  return payment!;
}

/** Add a succeeded payment to the bill's paid amount; the bill is paid when nothing is left. */
async function credit(tx: Transaction, bill: Bill, amountMinor: number, now: Date) {
  const paidMinor = bill.paidMinor + amountMinor;
  const [updated] = await tx
    .update(bills)
    .set({
      paidMinor,
      ...(paidMinor === bill.totalMinor && { status: "paid" as const, paidAt: now }),
    })
    .where(eq(bills.id, bill.id))
    .returning();
  return updated!;
}

/**
 * A guest at the table pays (part of) the bill online. Returns the
 * provider's payment page.
 */
export async function startGuestBillPayment(
  customer: Customer,
  sessionId: string | undefined,
  billId: string,
  input: BillPaymentRequest,
  now = new Date(),
): Promise<{ billPaymentId: string; redirectUrl: string | null }> {
  const request = requestSchema.parse(input);
  const session = await getCustomerTableSession(customer, sessionId, now);
  if (!session || !z.uuid().safeParse(billId).success) {
    throw new AppError("NOT_FOUND", "Bill not found.");
  }
  const { bill, payment } = await db.transaction(async (tx) => {
    const bill = await lockBill(
      tx,
      and(eq(bills.id, billId), eq(bills.tableSessionId, session.sessionId)),
    );
    const payment = await reserve(
      tx,
      bill,
      request,
      { kind: "guest", memberId: session.memberId },
      now,
    );
    return { bill, payment };
  });

  // Outside the transaction: the provider call. If it fails, the
  // reservation simply times out.
  const { payment: providerPayment, redirectUrl } = await startPayment({
    restaurantId: bill.restaurantId,
    purpose: "bill",
    customerUserId: customer.type === "user" ? customer.user.id : null,
    amountMinor: payment.amountMinor,
    currency: bill.currency,
    description: `Bill — ${session.restaurant.name}, table ${session.table.number}`,
    returnUrl: `${clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/table/bill/return/${payment.id}`,
    idempotencyKey: `bill-payment:${payment.id}`,
  });
  await db
    .update(billPayments)
    .set({ paymentId: providerPayment.id })
    .where(and(eq(billPayments.id, payment.id), isNull(billPayments.paymentId)));
  return { billPaymentId: payment.id, redirectUrl: redirectUrl ?? null };
}

/** Staff take cash or a card-terminal payment at the table (payment:confirm). */
export async function recordBillPayment(
  actor: Actor,
  restaurantId: string,
  billId: string,
  input: BillPaymentRequest & { method: "cash" | "card_terminal" },
  now = new Date(),
): Promise<{ payment: BillPayment; bill: Bill }> {
  await authorizeRestaurant(actor.id, restaurantId, "payment:confirm");
  const method = z.enum(["cash", "card_terminal"]).parse(input.method);
  const request = requestSchema.parse(input);
  if (!z.uuid().safeParse(billId).success) throw new AppError("NOT_FOUND", "Bill not found.");

  const result = await db.transaction(async (tx) => {
    const bill = await lockBill(
      tx,
      and(eq(bills.id, billId), eq(bills.restaurantId, restaurantId)),
    );
    const payment = await reserve(tx, bill, request, { kind: "staff", actor, method }, now);
    const updated = await credit(tx, bill, payment.amountMinor, now);
    await recordAudit(tx, {
      actor,
      action: "bill.payment_recorded",
      entityType: "bill",
      entityId: bill.id,
      restaurantId,
      metadata: {
        billPaymentId: payment.id,
        method,
        mode: request.mode,
        amountMinor: payment.amountMinor,
      },
    });
    return { payment, bill: updated };
  });
  await publishBillChanged(result.bill);
  return result;
}

/**
 * Apply a provider payment's outcome to the bill payment it pays for.
 * Idempotent; called by PaymentService after every check.
 */
export async function settleBillPayment(payment: Payment): Promise<void> {
  if (payment.purpose !== "bill") return;
  if (
    payment.status !== "succeeded" &&
    payment.status !== "failed" &&
    payment.status !== "cancelled"
  ) {
    return;
  }
  const outcome = await db.transaction(async (tx) => {
    const [link] = await tx
      .select({ billId: billPayments.billId })
      .from(billPayments)
      .where(eq(billPayments.paymentId, payment.id));
    if (!link) return { kind: "unknown" as const };
    const bill = await lockBill(tx, and(eq(bills.id, link.billId)));
    const [current] = await tx
      .select()
      .from(billPayments)
      .where(eq(billPayments.paymentId, payment.id))
      .for("update");
    const now = new Date();

    if (payment.status !== "succeeded") {
      if (current!.status === "pending") {
        await tx
          .update(billPayments)
          .set({ status: "failed" })
          .where(eq(billPayments.id, current!.id));
        await tx
          .update(billPaymentItems)
          .set({ active: false })
          .where(eq(billPaymentItems.billPaymentId, current!.id));
        return { kind: "released" as const, bill };
      }
      return { kind: "nothing" as const };
    }
    if (current!.status === "succeeded") return { kind: "nothing" as const };
    if (current!.status !== "pending" || bill.status !== "finalized") {
      // Money arrived after the share was given up (timed out) or the bill
      // was settled another way: give it back.
      return { kind: "refund" as const };
    }
    await tx
      .update(billPayments)
      .set({ status: "succeeded", settledAt: now })
      .where(eq(billPayments.id, current!.id));
    return { kind: "credited" as const, bill: await credit(tx, bill, current!.amountMinor, now) };
  });

  if (outcome.kind === "credited" || outcome.kind === "released") {
    await publishBillChanged(outcome.bill);
  } else if (outcome.kind === "refund") {
    try {
      await refundPaymentAutomatically(payment.restaurantId, payment.id, {
        amountMinor: payment.amountMinor - payment.refundedMinor,
        reason: "The bill share was no longer open when the payment arrived.",
        idempotencyKey: `payment:${payment.id}:refund:late-bill`,
      });
    } catch (error) {
      log.error("Automatic bill payment refund failed", { err: error, paymentId: payment.id });
    }
  }
}

/** What's paid, reserved and left on a bill, for the bill pages. */
export async function getBillPaymentState(billId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const bill = await lockBill(tx, and(eq(bills.id, billId)));
    if (bill.status === "finalized") await releaseExpired(tx, bill.id, now);
    const state = await stateOf(tx, bill);
    const payments = await tx.select().from(billPayments).where(eq(billPayments.billId, bill.id));
    return { ...state, payments };
  });
}

/** The online payment a guest's bill payment uses (for the return page). */
export async function findGuestBillPayment(billPaymentId: string) {
  if (!z.uuid().safeParse(billPaymentId).success) return null;
  const [row] = await db.select().from(billPayments).where(eq(billPayments.id, billPaymentId));
  return row ?? null;
}

/** Guests and staff screens look again (ids and status only, §28). */
async function publishBillChanged(bill: Bill) {
  const publisher = getRealtimePublisher();
  const hint = { type: "BILL_CHANGED", id: bill.id, status: bill.status };
  await Promise.all([
    publisher.publish(realtimeChannels.location(bill.restaurantId, bill.locationId), hint),
    publisher.publish(realtimeChannels.session(bill.tableSessionId), hint),
  ]);
  await queueBillClosedForPos(bill);
}
