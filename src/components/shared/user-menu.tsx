"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/** Signed-in user's name with a sign-out button. */
export function UserMenu({ name, className }: { name: string; className?: string }) {
  const t = useTranslations("Common");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-orange-100 text-sm font-bold text-orange-800 uppercase dark:bg-orange-900/40 dark:text-orange-300"
        >
          {name.trim().charAt(0)}
        </span>
        <span className="truncate text-sm text-muted-foreground">{name}</span>
      </span>
      <Button variant="ghost" size="sm" onClick={signOut} disabled={pending}>
        <LogOut aria-hidden />
        {t("signOut")}
      </Button>
    </div>
  );
}
