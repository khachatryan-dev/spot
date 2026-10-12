import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, type Executor } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { type Payment, paymentEvents, payments } from "@/server/db/schema";
import { logger } from "@/server/logger";
import { readLimitedText } from "@/server/http/read-limited";
import type { PaymentVerification } from "@/server/payments/provider";
import {
  activePaymentProvider,
  findPaymentProvider,
  paymentProviderNamed,
} from "@/server/payments/registry";
import type { PaymentPurpose } from "@/shared/constants/payments";
import { canMovePayment } from "@/shared/domain/payment-status";
import { AppError } from "@/shared/errors";

/*
 * PaymentService (§21): the only code that creates payments or changes their
 * status. Callers (reservation deposits, bills) authorize first. A status
 * changes only after asking the provider (`verifyPayment`) — never because a
 * browser or an unverified message says so (§49.4) — and only forward.
 */

const log = logger.child({ module: "payments" });

export interface StartPaymentInput {
  restaurantId: string;
  purpose: PaymentPurpose;
  reservationId?: string;
  customerUserId: string | null;
  amountMinor: number;
  currency: string;
  description: string;
  returnUrl: string;
  /** Stable per attempt (e.g. "reservation:<id>:deposit"): retries reuse the payment. */
  idempotencyKey: string;
}

const startSchema = z.object({
  restaurantId: z.uuid(),
  purpose: z.enum(["reservation_deposit", "bill"]),
  reservationId: z.uuid().optional(),
  customerUserId: z.uuid().nullable(),
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  description: z.string().min(1).max(200),
  returnUrl: z.url(),
  idempotencyKey: z.string().min(8).max(200),
});

export function recordPaymentEvent(
  executor: Executor,
  payment: Pick<Payment, "id" | "provider">,
  event: Omit<typeof paymentEvents.$inferInsert, "paymentId" | "provider">,
) {
  return executor
    .insert(paymentEvents)
    .values({ paymentId: payment.id, provider: payment.provider, ...event });
}

/**
 * Create (or, for the same idempotency key, reuse) a payment and its
 * provider side. Returns where to send the guest to pay.
 */
export async function startPayment(
  input: StartPaymentInput,
): Promise<{ payment: Payment; redirectUrl?: string }> {
  const data = startSchema.parse(input);
  const provider = activePaymentProvider();

  await db
    .insert(payments)
    .values({ ...data, provider: provider.name })
    .onConflictDoNothing({ target: payments.idempotencyKey });
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.idempotencyKey, data.idempotencyKey));
  if (
    !payment ||
    payment.amountMinor !== data.amountMinor ||
    payment.currency !== data.currency ||
    payment.restaurantId !== data.restaurantId ||
    payment.purpose !== data.purpose
  ) {
    throw new AppError("CONFLICT", "This payment was already started with different terms.");
  }
  if (payment.status !== "pending") return { payment };

  // The provider dedupes on the same key, so a retry after a crash here is safe.
  const created = await paymentProviderNamed(payment.provider).createPayment({
    paymentId: payment.id,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    description: data.description,
    returnUrl: data.returnUrl,
    idempotencyKey: payment.idempotencyKey,
  });
  if (!payment.providerPaymentId) {
    await db.transaction(async (tx) => {
      // Concurrent retries all get the same provider id; only the first records it.
      const [first] = await tx
        .update(payments)
        .set({ providerPaymentId: created.providerPaymentId })
        .where(and(eq(payments.id, payment.id), isNull(payments.providerPaymentId)))
        .returning({ id: payments.id });
      if (!first) return;
      await recordPaymentEvent(tx, payment, {
        type: "created",
        toStatus: "pending",
        amountMinor: payment.amountMinor,
        details: { providerPaymentId: created.providerPaymentId },
      });
    });
  }
  return {
    payment: { ...payment, providerPaymentId: created.providerPaymentId },
    redirectUrl: created.redirectUrl,
  };
}

export type SyncOutcome = "changed" | "unchanged" | "duplicate" | "ignored" | "mismatch";

/**
 * Ask the provider for the truth about a payment and apply it (§21). Called
 * when the guest returns from the payment page, by webhooks (with their
 * event id, so each event is applied once), and by reconciliation.
 */
export async function syncPayment(
  paymentId: string,
  options: { providerEventId?: string; source: "return" | "webhook" | "reconcile" },
): Promise<{ payment: Payment; outcome: SyncOutcome }> {
  const [found] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!found) throw new AppError("NOT_FOUND", "Payment not found.");
  if (!found.providerPaymentId) return { payment: found, outcome: "unchanged" };

  const truth = await paymentProviderNamed(found.provider).verifyPayment({
    providerPaymentId: found.providerPaymentId,
  });

  const result = await applyVerification(paymentId, truth, options);
  await applyPaymentEffects(result.payment);
  return result;
}

/**
 * What a payment's status means for the thing it pays for. Idempotent, so
 * it runs after every check (a crash between the two is healed next time).
 */
async function applyPaymentEffects(payment: Payment) {
  // Imported lazily: these services start payments here themselves.
  if (payment.purpose === "reservation_deposit") {
    const { settleDeposit } = await import("./reservation-deposit-service");
    await settleDeposit(payment);
  } else if (payment.purpose === "bill") {
    const { settleBillPayment } = await import("./bill-payment-service");
    await settleBillPayment(payment);
  }
}

async function applyVerification(
  paymentId: string,
  truth: PaymentVerification,
  options: { providerEventId?: string; source: "return" | "webhook" | "reconcile" },
): Promise<{ payment: Payment; outcome: SyncOutcome }> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for("update");
    const from = payment!.status;

    if (options.providerEventId) {
      // Each provider event is applied once, however often it's delivered.
      try {
        await tx.transaction((attempt) =>
          recordPaymentEvent(attempt, payment!, {
            providerEventId: options.providerEventId,
            type: "webhook_received",
            fromStatus: from,
            toStatus: truth.status,
          }),
        );
      } catch (error) {
        if (isUniqueViolation(error, "payment_events_provider_event_unique")) {
          return { payment: payment!, outcome: "duplicate" as const };
        }
        throw error;
      }
    }

    if (
      truth.providerPaymentId !== payment!.providerPaymentId ||
      truth.amountMinor !== payment!.amountMinor ||
      truth.currency !== payment!.currency
    ) {
      log.error("Payment amount mismatch", {
        paymentId,
        provider: payment!.provider,
        expected: { amountMinor: payment!.amountMinor, currency: payment!.currency },
        reported: { amountMinor: truth.amountMinor, currency: truth.currency },
      });
      await recordPaymentEvent(tx, payment!, {
        type: "amount_mismatch",
        fromStatus: from,
        toStatus: truth.status,
        amountMinor: truth.amountMinor,
        details: { currency: truth.currency, source: options.source },
      });
      // Never mark a payment paid when the money doesn't match.
      if (canMovePayment(from, "failed")) {
        const [failed] = await tx
          .update(payments)
          .set({ status: "failed", failureReason: "amount_mismatch" })
          .where(eq(payments.id, paymentId))
          .returning();
        return { payment: failed!, outcome: "mismatch" as const };
      }
      return { payment: payment!, outcome: "mismatch" as const };
    }

    if (truth.status === from) return { payment: payment!, outcome: "unchanged" as const };
    if (!canMovePayment(from, truth.status)) {
      await recordPaymentEvent(tx, payment!, {
        type: "ignored_transition",
        fromStatus: from,
        toStatus: truth.status,
        details: { source: options.source },
      });
      return { payment: payment!, outcome: "ignored" as const };
    }

    const [updated] = await tx
      .update(payments)
      .set({
        status: truth.status,
        ...(truth.status === "succeeded" && { succeededAt: new Date() }),
        ...(truth.status === "failed" && { failureReason: truth.failureReason ?? "failed" }),
      })
      .where(and(eq(payments.id, paymentId), eq(payments.status, from)))
      .returning();
    await recordPaymentEvent(tx, payment!, {
      type: "status_changed",
      fromStatus: from,
      toStatus: truth.status,
      amountMinor: truth.amountMinor,
      details: { source: options.source },
    });
    log.info("Payment status changed", { paymentId, from, to: truth.status });
    return { payment: updated!, outcome: "changed" as const };
  });
}

export async function getPayment(paymentId: string): Promise<Payment | null> {
  if (!z.uuid().safeParse(paymentId).success) return null;
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
  return payment ?? null;
}

/** Webhook bodies are small JSON; anything bigger isn't from a provider. */
const MAX_WEBHOOK_BYTES = 64 * 1024;

export type WebhookOutcome = SyncOutcome | "unknown_payment";

/**
 * A provider's webhook (§21): signature checked, then the payment is
 * re-verified with the provider and each event applied once. Errors other
 * than a bad request surface as 5xx so the provider retries later.
 */
export async function handlePaymentWebhook(
  providerName: string,
  request: Request,
): Promise<{ outcome: WebhookOutcome }> {
  const provider = findPaymentProvider(providerName);
  if (!provider) throw new AppError("NOT_FOUND");

  const body = await readLimitedText(request, MAX_WEBHOOK_BYTES);
  let event;
  try {
    event = await provider.handleWebhook(
      new Request(request.url, { method: "POST", headers: request.headers, body }),
    );
  } catch (error) {
    log.warn("Rejected payment webhook", { provider: providerName, err: error });
    throw new AppError("UNAUTHORIZED", "Invalid webhook signature.");
  }

  const [payment] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.provider, provider.name),
        eq(payments.providerPaymentId, event.providerPaymentId),
      ),
    );
  if (!payment) {
    // Acknowledge, so the provider stops retrying something we'll never know.
    log.warn("Webhook for an unknown payment", {
      provider: provider.name,
      providerPaymentId: event.providerPaymentId,
      eventId: event.eventId,
    });
    return { outcome: "unknown_payment" };
  }

  const { outcome } = await syncPayment(payment.id, {
    providerEventId: event.eventId,
    source: "webhook",
  });
  log.info("Payment webhook", { provider: provider.name, eventId: event.eventId, outcome });
  return { outcome };
}
