"use server";

import { randomUUID } from "node:crypto";

import { notFound, redirect } from "next/navigation";

import { fakeProvider } from "@/server/payments/registry";
import { handlePaymentWebhook } from "@/server/services/payment-service";
import { clientEnv } from "@/shared/config/env.client";

/**
 * The test payment page's buttons (development / E2E only). Like a real
 * provider: change the payment, notify us by signed webhook, send the guest
 * back. Only our own URLs are allowed as the way back.
 */
export async function finishFakePaymentAction(formData: FormData) {
  const bank = fakeProvider();
  if (!bank) notFound();
  const providerPaymentId = String(formData.get("providerPaymentId"));
  const back = String(formData.get("return") ?? "");
  if (formData.get("outcome") === "pay") bank.complete(providerPaymentId);
  else bank.fail(providerPaymentId, "declined");

  await handlePaymentWebhook(
    "fake",
    bank.webhookRequest({
      eventId: `evt_${randomUUID()}`,
      providerPaymentId,
      type: "payment.updated",
    }),
  );
  const appUrl = clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  redirect(back.startsWith(`${appUrl}/`) ? back : "/");
}
