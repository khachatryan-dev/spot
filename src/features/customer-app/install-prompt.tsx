"use client";

import { Download, Share, Smartphone, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useHydrated } from "@/components/shared/use-hydrated";
import { Button } from "@/components/ui/button";

/** Chromium's install event (not in TypeScript's DOM types). */
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISSED = "spot-install-dismissed";

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

/**
 * "Add Spot to your home screen". Android / desktop Chrome get an Install
 * button (when the browser offers it); iPhone and iPad get the two Safari
 * steps, since Safari has no install prompt. Hidden once installed or closed.
 */
export function InstallPrompt() {
  const t = useTranslations("CustomerApp.install");
  const hydrated = useHydrated();
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => setClosed(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!hydrated || closed || wasDismissed()) return null;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (standalone || (!event && !ios)) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // Private mode: it just shows again next time.
    }
    setClosed(true);
  }

  return (
    <section
      aria-labelledby="install-title"
      className="relative flex gap-3 rounded-3xl bg-card p-4 pr-10 shadow-sm ring-1 ring-border"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
        <Smartphone className="size-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 id="install-title" className="font-semibold">
          {t("title")}
        </h2>
        {event ? (
          <>
            <p className="text-sm text-muted-foreground">{t("text")}</p>
            <Button
              size="sm"
              className="self-start rounded-full px-3"
              onClick={async () => {
                await event.prompt();
                const { outcome } = await event.userChoice;
                if (outcome === "accepted") setClosed(true);
                setEvent(null);
              }}
            >
              <Download aria-hidden />
              {t("install")}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t.rich("ios", {
              share: () => <Share className="mx-0.5 inline size-4 align-text-bottom" aria-hidden />,
              b: (chunks) => <strong className="text-foreground">{chunks}</strong>,
            })}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("close")}
        className="absolute top-3 right-3 grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted"
      >
        <X className="size-4" aria-hidden />
      </button>
    </section>
  );
}
