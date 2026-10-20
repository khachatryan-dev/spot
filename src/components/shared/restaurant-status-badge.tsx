import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { RestaurantStatus } from "@/shared/constants/restaurants";

/** One colour per status, so owners can tell at a glance where they stand. */
const COLORS: Record<RestaurantStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  pending_review: "bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-300",
  active: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300",
  suspended: "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300",
  closed: "bg-muted text-muted-foreground border-border",
};

export function RestaurantStatusBadge({ status }: { status: RestaurantStatus }) {
  const t = useTranslations("RestaurantStatus");
  return (
    <Badge variant="outline" className={COLORS[status]}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {t(status)}
    </Badge>
  );
}
