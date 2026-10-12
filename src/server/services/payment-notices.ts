import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { type Payment, restaurants } from "@/server/db/schema";
import { emailLocale } from "@/server/email/templates";
import { logger } from "@/server/logger";
import { clientEnv } from "@/shared/config/env.client";
import { formatMoney } from "@/shared/utils/money";

import { notify, recipientOf, sendEmail } from "./notification-service";

const log = logger.child({ module: "payment-notices" });

/** Tell the payer about a refund (in-app + email). Never throws. */
export async function announceRefund(payment: Payment, amountMinor: number) {
  try {
    if (!payment.customerUserId) return;
    const [restaurant] = await db
      .select({ name: restaurants.name })
      .from(restaurants)
      .where(eq(restaurants.id, payment.restaurantId));
    const guest = await recipientOf(payment.customerUserId);
    const locale = emailLocale(guest?.preferredLocale);
    const amount = formatMoney(amountMinor, payment.currency, locale);
    await notify([payment.customerUserId], {
      type: "refund_issued",
      restaurantId: payment.restaurantId,
      data: { restaurant: restaurant?.name ?? "", amountMinor, currency: payment.currency },
      link: "/account",
    });
    if (guest) {
      const base = clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
      await sendEmail({
        to: guest.email,
        template: "refund_issued",
        locale,
        values: { name: guest.name ?? "", restaurant: restaurant?.name ?? "", amount },
        action: { url: `${base}${locale === "hy" ? "" : `/${locale}`}/account` },
      });
    }
  } catch (err) {
    log.error("Refund announcement failed", { err, paymentId: payment.id });
  }
}
