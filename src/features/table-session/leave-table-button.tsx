"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

import { leaveTableAction } from "./actions";

export function LeaveTableButton() {
  const t = useTranslations("TableSession");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!window.confirm(t("leaveConfirm"))) return;
        setPending(true);
        await leaveTableAction();
        router.refresh();
      }}
    >
      <LogOut aria-hidden />
      {t("leave")}
    </Button>
  );
}
