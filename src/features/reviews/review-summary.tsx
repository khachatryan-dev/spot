import { getFormatter, getTranslations } from "next-intl/server";

import type { PublicReview } from "@/server/services/review-service";

import { Stars } from "./stars";

/** A restaurant's rating and latest reviews, with its replies (§24). */
export async function ReviewSummary({
  average,
  count,
  recent,
}: {
  average: number | null;
  count: number;
  recent: PublicReview[];
}) {
  const t = await getTranslations("Reviews");
  const format = await getFormatter();
  if (count === 0) return null;
  return (
    <section aria-labelledby="reviews-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="reviews-heading" className="font-semibold">
          {t("publicTitle")}
        </h2>
        <Stars rating={average ?? 0} label={t("averageLabel", { average: average ?? 0 })} />
        <span className="text-sm text-muted-foreground">
          {format.number(average ?? 0, { maximumFractionDigits: 1 })} · {t("count", { count })}
        </span>
      </div>
      <ul className="flex flex-col gap-3">
        {recent.map((r) => (
          <li key={r.id} className="flex flex-col gap-1 rounded-xl border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{r.displayName}</span>
              <Stars rating={r.rating} label={t("ratingOf", { rating: r.rating })} />
            </div>
            <span className="text-xs text-muted-foreground">
              {format.dateTime(r.publishedAt, { day: "numeric", month: "long", year: "numeric" })}
            </span>
            {r.comment && <p className="whitespace-pre-line">{r.comment}</p>}
            {r.response && (
              <p className="mt-1 rounded-lg bg-muted/50 p-2">
                <span className="font-medium">{t("responseLabel")}</span> {r.response}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
