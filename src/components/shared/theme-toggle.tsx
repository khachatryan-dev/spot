"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

import { useHydrated } from "./use-hydrated";

/** Light / dark switch. Follows the device until the person picks one. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("Common.theme");
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is only known in the browser; render a neutral button until then.
  const hydrated = useHydrated();
  const dark = hydrated && resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={t(dark ? "toLight" : "toDark")}
      title={t(dark ? "toLight" : "toDark")}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
