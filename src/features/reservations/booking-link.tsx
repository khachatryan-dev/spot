"use client";

import { Copy, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** The location's public booking link with copy and open buttons. */
export function BookingLink({ url }: { url: string }) {
  const t = useTranslations("StaffReservations");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("linkCopied"));
    } catch {
      toast.error(t("linkCopyFailed"));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="booking-link" className="text-sm font-medium">
        {t("bookingLink")}
      </label>
      <div className="flex gap-2">
        <Input
          id="booking-link"
          readOnly
          value={url}
          data-testid="booking-url"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label={t("copyLink")}
        >
          <Copy aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("openLink")}
          render={<a href={url} target="_blank" rel="noopener" />}
        >
          <ExternalLink aria-hidden />
        </Button>
      </div>
    </div>
  );
}
