import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";
import type { ReservationStatus } from "@/shared/constants/reservations";

const COLORS: Record<ReservationStatus, string> = {
  pending_payment: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300",
  pending_confirmation: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300",
  confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  arrived: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  seated: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  no_show: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  expired: "bg-muted text-muted-foreground",
};

/** A booking's status as a coloured pill: waiting (amber), on (green), off (red/grey). */
export async function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  const t = await getTranslations("Reservations.status");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        COLORS[status],
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {t(status)}
    </span>
  );
}
