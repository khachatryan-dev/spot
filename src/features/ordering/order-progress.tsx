import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/shared/constants/orders";
import { GUEST_PROGRESS_STEPS, guestProgress } from "@/shared/domain/order-status";

/**
 * Five-step tracker under an order: sent → accepted → cooking → ready → served.
 * Decorative: the status badge next to it already says the same to screen readers.
 */
export async function OrderProgress({ status }: { status: OrderStatus }) {
  const step = guestProgress(status);
  if (step === null) return null;
  const t = await getTranslations("Orders.progress");

  return (
    <div className="grid grid-cols-5 gap-1" aria-hidden>
      {GUEST_PROGRESS_STEPS.map((name, index) => (
        <div key={name} className="flex flex-col gap-1">
          <span
            className={cn(
              "h-1.5 rounded-full",
              index < step && "bg-emerald-600",
              index === step && (step === 4 ? "bg-emerald-600" : "bg-orange-600"),
              index > step && "bg-muted",
            )}
          />
          <span
            className={cn(
              "truncate text-[11px]",
              index <= step ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {t(name)}
          </span>
        </div>
      ))}
    </div>
  );
}
