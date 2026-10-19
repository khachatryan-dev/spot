"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useRun } from "@/features/menu-editor/use-run";
import type { ContactStatus } from "@/shared/constants/contact";

import { setContactMessageStatusAction } from "./actions";

/** Mark a contact message handled, or reopen it. */
export function MessageStatusButton({
  messageId,
  name,
  status,
}: {
  messageId: string;
  name: string;
  status: ContactStatus;
}) {
  const t = useTranslations("AdminMessages");
  const { busy, run } = useRun();
  const next: ContactStatus = status === "new" ? "handled" : "new";

  return (
    <Button
      size="sm"
      variant={next === "handled" ? "default" : "outline"}
      className="self-start"
      disabled={busy !== null}
      aria-label={t(next === "handled" ? "markHandledLabel" : "reopenLabel", { name })}
      onClick={() =>
        void run(next, () => setContactMessageStatusAction(messageId, next), t("done"))
      }
    >
      {t(next === "handled" ? "markHandled" : "reopen")}
    </Button>
  );
}
