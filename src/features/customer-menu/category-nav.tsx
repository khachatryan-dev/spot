"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Sticky, horizontally scrolling category chips; highlights the section in view. */
export function CategoryNav({ categories }: { categories: { id: string; name: string }[] }) {
  const t = useTranslations("CustomerMenu");
  const [active, setActive] = useState(categories[0]?.id);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id.replace("cat-", ""));
      },
      { rootMargin: "-56px 0px -60% 0px" },
    );
    for (const { id } of categories) {
      const el = document.getElementById(`cat-${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [categories]);

  // Keep the active chip in view: scroll the chip row only, never the page.
  useEffect(() => {
    const nav = navRef.current;
    const chip = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!nav || !chip) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollTo({
      left: chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [active]);

  return (
    <nav
      ref={navRef}
      aria-label={t("categories")}
      className="sticky top-0 z-10 -mx-4 [scrollbar-width:none] overflow-x-auto bg-background/95 px-4 py-2.5 shadow-[0_1px_0_var(--border)] backdrop-blur"
    >
      <ul className="flex gap-2">
        {categories.map((category) => (
          <li key={category.id}>
            <a
              href={`#cat-${category.id}`}
              aria-current={active === category.id ? "true" : undefined}
              className={cn(
                "block rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active === category.id
                  ? "bg-primary text-primary-foreground shadow-sm shadow-orange-700/20"
                  : "bg-secondary text-secondary-foreground hover:bg-orange-100 dark:hover:bg-orange-900/40",
              )}
            >
              {category.name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
