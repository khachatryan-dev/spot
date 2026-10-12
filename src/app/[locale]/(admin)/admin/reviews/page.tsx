import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModerationActions } from "@/features/admin-reviews/moderation-actions";
import { Stars } from "@/features/reviews/stars";
import { resolveLocale } from "@/i18n/locale";
import { guardPage, requirePlatformPermission } from "@/server/auth/guards";
import {
  listReviewsForModeration,
  type ModerationItem,
} from "@/server/services/admin-review-service";
import { availableDecisions } from "@/shared/domain/review-moderation";

/** Review moderation (§24): reported reviews first, then recent ones. */
export default async function AdminReviewsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/reviews">) {
  const locale = await resolveLocale(params);
  const { q } = await searchParams;
  const search = typeof q === "string" ? q : "";
  const { reported, recent } = await guardPage(locale, async () =>
    listReviewsForModeration(await requirePlatformPermission("platform:reviews:moderate"), {
      search,
    }),
  );
  const t = await getTranslations("AdminReviews");
  const r = await getTranslations("Reviews");
  const format = await getFormatter();

  const item = (review: ModerationItem, showReport: boolean) => (
    <li key={`${showReport}-${review.id}`} className="flex flex-col gap-2 rounded-2xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {review.restaurantName} · {review.displayName}
        </span>
        <Stars rating={review.rating} label={r("ratingOf", { rating: review.rating })} />
      </div>
      <span className="text-xs text-muted-foreground">
        {format.dateTime(review.createdAt, { dateStyle: "medium", timeStyle: "short" })}
        {review.authorEmail && (
          <>
            {" "}
            · {review.authorEmail} (
            {t(review.authorEmailVerified ? "emailVerified" : "emailUnverified")})
          </>
        )}
      </span>
      <div className="flex flex-wrap gap-2">
        <Badge variant={review.status === "published" ? "default" : "outline"}>
          {r(`status.${review.status}`)}
        </Badge>
        {review.reportedAt && !review.moderatedAt && (
          <Badge variant="outline">{t("reported")}</Badge>
        )}
      </div>
      {review.comment && <p className="text-sm whitespace-pre-line">{review.comment}</p>}
      {showReport && review.reportReason && (
        <p className="rounded-lg bg-destructive/10 p-2 text-sm">
          {t("reportReason", { reason: review.reportReason })}
        </p>
      )}
      {review.moderationReason && (
        <p className="text-xs text-muted-foreground">
          {t("decisionNote", { reason: review.moderationReason })}
        </p>
      )}
      <ModerationActions
        reviewId={review.id}
        author={review.displayName}
        decisions={availableDecisions(review.status).filter(
          (d) => d !== "keep" || (review.reportedAt !== null && review.moderatedAt === null),
        )}
      />
    </li>
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <form className="flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          {t("search")}
        </label>
        <Input id="q" name="q" defaultValue={search} placeholder={t("searchPlaceholder")} />
        <Button type="submit" variant="secondary">
          {t("search")}
        </Button>
      </form>
      <section aria-labelledby="reported-heading" className="flex flex-col gap-3">
        <h2 id="reported-heading" className="text-lg font-semibold">
          {t("reportedTitle", { count: reported.length })}
        </h2>
        {reported.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noReports")}</p>
        ) : (
          <ul className="flex flex-col gap-3">{reported.map((review) => item(review, true))}</ul>
        )}
      </section>
      <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
        <h2 id="recent-heading" className="text-lg font-semibold">
          {t("recentTitle")}
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="flex flex-col gap-3">{recent.map((review) => item(review, false))}</ul>
        )}
      </section>
    </div>
  );
}
