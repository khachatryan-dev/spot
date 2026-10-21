"use client";

import type { ReactNode } from "react";

import { usePathname } from "@/i18n/navigation";

import { hideAppBars } from "./app-tab-bar";

/** The app's top bar (logo, bell, theme, language); hidden at the table, which has its own header. */
export function AppTopBar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (hideAppBars(pathname)) return null;
  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between gap-2 px-4">
        {children}
      </div>
    </header>
  );
}
