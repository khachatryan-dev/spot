import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { MyReview } from "@/features/reviews/my-review";
import { ReviewForm } from "@/features/reviews/review-form";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getCustomer } from "@/server/guests/current-customer";
import { listMyReviews, listReviewOpportunities } from "@/server/services/review-service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Reviews");
  return { title: t("title"), robots: { index: false } };
}

/** Visits to rate, and (signed in) the guest's own reviews (§24). */
export default async function ReviewsPage({ params }: PageProps<"/[locale]/reviews">) {
  await resolveLocale(params);
  const customer = await getCustomer();
  const t = await getTranslations("Reviews");
  const format = await getFormatter();
  const opportunities = customer ? await listReviewOpportunities(customer) : [];
  const mine = customer?.type === "user" ? await listMyReviews(customer.user) : [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {opportunities.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("nothingToRate")}</p>
      ) : (
        opportunities.map((o) => (
          <ReviewForm
            key={`${o.subject}-${o.targetId}`}
            subject={o.subject}
            targetId={o.targetId}
            anonymous={customer?.type === "guest"}
            heading={t("rateHeading", {
              restaurant: o.restaurantName,
              location: o.locationName,
              date: format.dateTime(o.visitedAt, { day: "numeric", month: "long" }),
            })}
          />
        ))
      )}
      {customer?.type === "guest" && (
        <p className="text-sm text-muted-foreground">
          {t("signInHint")}{" "}
          <Link
            href={{ pathname: "/login", query: { next: "/reviews" } }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("signIn")}
          </Link>
        </p>
      )}
      {mine.length > 0 && (
        <section aria-labelledby="mine-heading" className="flex flex-col gap-3">
          <h2 id="mine-heading" className="text-lg font-semibold">
            {t("mineTitle")}
          </h2>
          <ul className="flex flex-col gap-3">
            {mine.map((r) => (
              <MyReview key={r.id} review={r} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
