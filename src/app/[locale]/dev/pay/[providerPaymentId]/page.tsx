import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { finishFakePaymentAction } from "@/features/dev-payments/actions";
import { resolveLocale } from "@/i18n/locale";
import { fakeProvider } from "@/server/payments/registry";
import { formatMoney } from "@/shared/utils/money";

export const metadata: Metadata = { robots: { index: false } };

/** Stand-in for a bank's hosted payment page (development / E2E only). */
export default async function FakePaymentPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dev/pay/[providerPaymentId]">) {
  const locale = await resolveLocale(params);
  const bank = fakeProvider();
  if (!bank) notFound();
  const { providerPaymentId } = await params;
  const payment = await bank.verifyPayment({ providerPaymentId }).catch(() => null);
  if (!payment) notFound();
  const back = (await searchParams).return;
  const t = await getTranslations("DevPayment");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6">
      <p className="flex items-center gap-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-950">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        {t("warning")}
      </p>
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-3xl font-semibold tabular-nums">
        {formatMoney(payment.amountMinor, payment.currency, locale)}
      </p>
      {payment.status === "pending" ? (
        <form action={finishFakePaymentAction} className="flex flex-col gap-2">
          <input type="hidden" name="providerPaymentId" value={providerPaymentId} />
          <input type="hidden" name="return" value={typeof back === "string" ? back : ""} />
          <Button type="submit" name="outcome" value="pay">
            {t("pay")}
          </Button>
          <Button type="submit" name="outcome" value="decline" variant="outline">
            {t("decline")}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{t("done")}</p>
      )}
    </main>
  );
}
