import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { RestaurantStatus } from "@/shared/constants/restaurants";

const VARIANT: Record<RestaurantStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  pending_review: "secondary",
  active: "default",
  suspended: "destructive",
  closed: "outline",
};

export function RestaurantStatusBadge({ status }: { status: RestaurantStatus }) {
  const t = useTranslations("RestaurantStatus");
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
