"use client";

import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useRun } from "@/features/menu-editor/use-run";
import { cn } from "@/lib/utils";

import { setFavoriteAction } from "./actions";

/** Save a restaurant (signed in) or go sign in first. */
export function FavoriteButton({
  restaurantId,
  restaurantName,
  saved: initiallySaved,
  loginHref,
}: {
  restaurantId: string;
  restaurantName: string;
  saved: boolean;
  /** Set when signed out. */
  loginHref: string | null;
}) {
  const t = useTranslations("Account");
  const { busy, run } = useRun();
  const [saved, setSaved] = useState(initiallySaved);
  const label = t(saved ? "unsave" : "save_favorite", { name: restaurantName });
  const icon = <Heart aria-hidden className={cn(saved && "fill-red-500 text-red-500")} />;

  if (loginHref) {
    return (
      <Button variant="outline" size="icon" aria-label={label} render={<Link href={loginHref} />}>
        {icon}
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={label}
      aria-pressed={saved}
      disabled={busy !== null}
      onClick={async () => {
        const result = await run("favorite", () => setFavoriteAction(restaurantId, !saved));
        if (result) setSaved(result.saved);
      }}
    >
      {icon}
    </Button>
  );
}
