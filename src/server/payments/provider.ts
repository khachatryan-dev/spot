import type { PaymentStatus } from "@/shared/constants/payments";

/*
 * Payment provider abstraction (§5 Payments, §21). Business code talks to
 * PaymentService, which talks to this interface; banks and wallets plug in
 * behind it. Amounts are integer minor units.
 */

export interface CreatePaymentInput {
  /** Our payment id; providers echo it back as their order reference. */
  paymentId: string;
  amountMinor: number;
  currency: string;
  description: string;
  /** Where the provider sends the guest after paying (or giving up). */
  returnUrl: string;
  /** Same key → same provider payment, so a retried call never charges twice. */
  idempotencyKey: string;
}

export interface PaymentResult {
  providerPaymentId: string;
  status: PaymentStatus;
  /** Hosted payment page to send the guest to, if the provider uses one. */
  redirectUrl?: string;
}

export interface VerifyPaymentInput {
  providerPaymentId: string;
}

/** The provider's own record of a payment — the only source of truth (§21). */
export interface PaymentVerification {
  providerPaymentId: string;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  failureReason?: string;
}

export interface RefundPaymentInput {
  providerPaymentId: string;
  amountMinor: number;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  /** "succeeded" or "failed"; some providers refund asynchronously ("processing"). */
  status: "processing" | "succeeded" | "failed";
}

/** A webhook whose signature has been checked. */
export interface WebhookResult {
  /** Unique per provider event; repeats of the same event are ignored. */
  eventId: string;
  providerPaymentId: string;
  type: string;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<PaymentResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<PaymentVerification>;
  refundPayment(input: RefundPaymentInput): Promise<RefundResult>;
  /**
   * Check the signature and parse the event. Throws on a bad signature.
   * Callers still re-verify the payment with `verifyPayment` before acting:
   * a webhook says "look again", not "trust me".
   */
  handleWebhook(request: Request): Promise<WebhookResult>;
}
