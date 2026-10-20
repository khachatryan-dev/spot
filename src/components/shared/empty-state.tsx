import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Friendly "nothing here yet" block for dashboard lists: icon, message, optional action. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title?: string;
  /** The message; keep it a sentence that says what will appear here or what to do. */
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-3xl bg-gradient-to-br from-orange-50/80 to-amber-50/60 px-6 py-10 text-center ring-1 ring-orange-100 dark:from-orange-950/40 dark:to-amber-950/40 dark:ring-orange-900/50",
        className,
      )}
    >
      <span className="grid size-14 place-items-center rounded-2xl bg-white text-orange-600 shadow-sm ring-1 ring-orange-100 dark:bg-card dark:text-orange-400 dark:ring-orange-900/50">
        <Icon className="size-7" aria-hidden />
      </span>
      {title && <p className="text-lg font-semibold">{title}</p>}
      <p className="max-w-sm text-sm text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}
