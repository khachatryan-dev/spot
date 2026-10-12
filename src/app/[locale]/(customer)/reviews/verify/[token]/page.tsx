import { CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { verifyReviewEmail } from "@/server/services/review-service";

export const metadata: Metadata = { robots: { index: false } };

/** The link from the review email: confirms the author's address (§24). */
export default async function VerifyReviewEmailPage({
  params,
}: PageProps<"/[locale]/reviews/verify/[token]">) {
  await resolveLocale(params);
  const { token } = await params;
  const confirmed = await verifyReviewEmail(token);
  const t = await getTranslations("Reviews");
  const Icon = confirmed ? CheckCircle2 : XCircle;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <Icon className="size-12 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">{t(confirmed ? "verified" : "verifyFailed")}</h1>
      <Link href="/restaurants" className="text-sm font-medium underline-offset-4 hover:underline">
        {t("browse")}
      </Link>
    </div>
  );
}
