"use client";

import { useEffect, useState } from "react";

import { useRouter } from "@/i18n/navigation";

/**
 * Keeps a server-rendered page fresh (ADR 0001). With realtime enabled it
 * subscribes to `channel` and re-fetches the page shortly after each hint —
 * hints carry no data, the page itself is the source of truth (§28). Polling
 * covers the gaps: every `fallbackSeconds` while disconnected (or when
 * realtime is off), and a slow safety refresh while connected.
 */
export function LiveRefresh({
  channel,
  enabled,
  fallbackSeconds = 15,
}: {
  channel: string;
  enabled: boolean;
  fallbackSeconds?: number;
}) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let client: { close: () => void } | undefined;

    void (async () => {
      const Ably = (await import("ably")).default;
      if (closed) return;
      const realtime = new Ably.Realtime({
        authCallback: (_params, callback) => {
          fetch("/api/realtime/token", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ channel }),
          })
            .then((res) => res.json())
            .then(
              (json: {
                data: Parameters<typeof callback>[1];
                error: { message: string } | null;
              }) => (json.error ? callback(json.error.message, null) : callback(null, json.data)),
            )
            .catch((err: unknown) => callback(String(err), null));
        },
      });
      client = realtime;
      realtime.connection.on((change) => setConnected(change.current === "connected"));
      await realtime.channels.get(channel).subscribe(() => {
        // Several hints in a burst → one refresh.
        clearTimeout(debounce);
        debounce = setTimeout(() => router.refresh(), 300);
      });
    })().catch(() => setConnected(false));

    return () => {
      closed = true;
      clearTimeout(debounce);
      client?.close();
    };
  }, [channel, enabled, router]);

  useEffect(() => {
    const seconds = connected ? 60 : fallbackSeconds;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [connected, fallbackSeconds, router]);

  return null;
}
