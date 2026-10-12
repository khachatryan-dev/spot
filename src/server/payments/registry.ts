import "server-only";

import { env } from "@/shared/config/env";
import { clientEnv } from "@/shared/config/env.client";
import { AppError } from "@/shared/errors";

import { createFakeProvider, type FakeProvider } from "./fake-provider";
import type { PaymentProvider } from "./provider";

/*
 * Which provider handles payments. Real providers are added on the provider
 * day; until then only the in-memory fake exists: on in development, and in
 * a production build only when PAYMENT_PROVIDER=fake (E2E). A payment
 * remembers its provider, so later calls (verify, refund, webhooks) go to
 * the one that created it.
 */

let fake: PaymentProvider | undefined;
let override: PaymentProvider | undefined;

const fakeAllowed = () => env.NODE_ENV !== "production" || env.PAYMENT_PROVIDER === "fake";

const providers = (): Record<string, () => PaymentProvider | null> => ({
  fake: () =>
    fakeAllowed()
      ? (fake ??= createFakeProvider({
          payPageUrl: `${clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/dev/pay`,
        }))
      : null,
});

/** Can guests pay online here at all? */
export const paymentsAvailable = () => override !== undefined || fakeAllowed();

/** The provider for new payments. */
export function activePaymentProvider(): PaymentProvider {
  if (override) return override;
  const provider = providers()[env.PAYMENT_PROVIDER ?? "fake"]?.();
  if (!provider) {
    throw new AppError("RESOURCE_UNAVAILABLE", "Online payments aren't available yet.");
  }
  return provider;
}

/** A provider by name, or null if there's no such provider here (webhook URLs). */
export function findPaymentProvider(name: string): PaymentProvider | null {
  if (override?.name === name) return override;
  return Object.hasOwn(providers(), name) ? providers()[name]!() : null;
}

/** The provider that created a payment. */
export function paymentProviderNamed(name: string): PaymentProvider {
  const provider = findPaymentProvider(name);
  if (!provider) {
    throw new AppError("INTERNAL_ERROR", undefined, { cause: `Unknown payment provider ${name}` });
  }
  return provider;
}

/** The in-memory fake, when it's the active provider (development test page). */
export function fakeProvider(): FakeProvider | null {
  const provider = override ?? (fakeAllowed() ? activePaymentProvider() : null);
  return provider?.name === "fake" && "complete" in provider ? (provider as FakeProvider) : null;
}

/** Tests swap in their own provider. */
export function setPaymentProviderForTests(provider: PaymentProvider | undefined) {
  override = provider;
}
