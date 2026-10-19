import { UtensilsCrossed } from "lucide-react";

/**
 * The Spot mark: a warm badge with the app name next to it. `compact` keeps
 * only the badge on phones (the header has no room); the name stays readable
 * to screen readers.
 */
export function Logo({ name, compact = false }: { name: string; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-lg font-bold tracking-tight">
      <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-sm shadow-orange-500/30">
        <UtensilsCrossed className="size-4" aria-hidden />
      </span>
      <span className={compact ? "max-sm:sr-only" : undefined}>{name}</span>
    </span>
  );
}
