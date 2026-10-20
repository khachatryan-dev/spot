import { MessageSquareHeart } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { ReviewReply } from "@/features/reviews/review-reply";
import { Stars } from "@/features/reviews/stars";
import { resolveLocale } from "@/i18n/locale";
import { guardPage, requireUser } from "@/server/auth/guards";
import { listRestaurantReviews } from "@/server/services/restaurant-review-service";

/** The restaurant's reviews: reply in public, report unfair ones (§24). */
export default async function RestaurantReviewsPage({
  params,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/reviews">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const data = await guardPage(locale, async () =>
    listRestaurantReviews(await requireUser(), restaurantId),
  );
  const t = await getTranslations("RestaurantReviews");
  const stars = await getTranslations("Reviews");
  const format = await getFormatter();

  return (
    <div className="flex flex-col gap-4">
      {data.count > 0 && (
        <p className="flex items-center gap-2 text-sm">
          <Stars
            rating={data.average ?? 0}
            label={stars("averageLabel", { average: data.average ?? 0 })}
          />
          {format.number(data.average ?? 0, { maximumFractionDigits: 1 })} ·{" "}
          {stars("count", { count: data.count })}
        </p>
      )}
      {data.reviews.length === 0 ? (
        <EmptyState icon={MessageSquareHeart}>{t("empty")}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t("listLabel")}>
          {data.reviews.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-2xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{r.displayName}</span>
                <Stars rating={r.rating} label={stars("ratingOf", { rating: r.rating })} />
              </div>
              <span className="text-xs text-muted-foreground">
                {format.dateTime(r.createdAt, { day: "numeric", month: "long", year: "numeric" })} ·{" "}
                {r.locationName} · {t(`subject.${r.subject}`)}
              </span>
              <div className="flex flex-wrap gap-2">
                {r.status !== "published" && (
                  <Badge variant="outline">{stars(`status.${r.status}`)}</Badge>
                )}
                {r.reportedAt && <Badge variant="outline">{t("reportedBadge")}</Badge>}
              </div>
              {r.comment && <p className="text-sm whitespace-pre-line">{r.comment}</p>}
              {r.status !== "published" && r.moderationReason && (
                <p className="text-xs text-muted-foreground">
                  {t("moderationNote", { reason: r.moderationReason })}
                </p>
              )}
              <ReviewReply
                restaurantId={restaurantId}
                reviewId={r.id}
                guest={r.displayName}
                response={r.response}
                canReply={r.status === "published"}
                reported={!!r.reportedAt}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
