"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** Sticky, horizontally scrolling category chips; highlights the section in view. */
export function CategoryNav({ categories }: { categories: { id: string; name: string }[] }) {
  const t = useTranslations("CustomerMenu");
  const [active, setActive] = useState(categories[0]?.id);

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

  return (
    <nav
      aria-label={t("categories")}
      className="sticky top-0 z-10 -mx-4 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur"
    >
      <ul className="flex gap-2">
        {categories.map((category) => (
          <li key={category.id}>
            <a
              href={`#cat-${category.id}`}
              aria-current={active === category.id ? "true" : undefined}
              className={cn(
                "block rounded-full border px-3 py-1.5 text-sm whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active === category.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background",
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
