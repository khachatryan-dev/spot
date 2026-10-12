"use client";

import { useState } from "react";

/**
 * Show a new value immediately while a save is in flight. Once fresh server
 * data arrives (the server value changes), it takes over again; `reset`
 * reverts after a failed save.
 */
export function useOptimisticValue<T>(server: T): [T, (value: T) => void, () => void] {
  const [local, setLocal] = useState<{ base: T; value: T } | null>(null);
  const value = local && Object.is(local.base, server) ? local.value : server;
  return [value, (next) => setLocal({ base: server, value: next }), () => setLocal(null)];
}
