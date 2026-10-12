"use client";

import { Loader2, LocateFixed } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Sort by distance from the guest. The browser asks for permission only
 * when this is tapped; the position goes into the URL (rounded to ~100 m)
 * and is never stored.
 */
export function NearMeButton({ params }: { params: Record<string, string> }) {
  const t = useTranslations("Discover");
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  function locate() {
    if (!("geolocation" in navigator)) {
      toast.error(t("noLocation"));
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setBusy(false);
        const near = `${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)}`;
        router.push({ pathname, query: { ...params, near, sort: "distance" } });
      },
      () => {
        setBusy(false);
        toast.error(t("noLocation"));
      },
      { maximumAge: 300_000, timeout: 10_000 },
    );
  }

  return (
    <Button type="button" variant="outline" disabled={busy} onClick={locate}>
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <LocateFixed aria-hidden />}
      {t("nearMe")}
    </Button>
  );
}
