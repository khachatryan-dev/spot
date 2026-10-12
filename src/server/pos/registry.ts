import "server-only";

import { outboundFetch } from "@/server/http/outbound";
import { env } from "@/shared/config/env";

import { createFakePos, type FakePos } from "./fake-pos";
import { oneCExchangeProvider } from "./onec/onec-exchange-provider";
import { createOneCHttpProvider } from "./onec/onec-http-provider";
import type { PosProvider } from "./provider";

/*
 * Which POS systems Spot can talk to (§29), added one by one:
 *   1c           1C publishes an HTTP service; Spot calls it.
 *   1c-exchange  1C calls Spot's exchange API.
 * The in-memory fake is for development and tests only and never exists in
 * a production build.
 */

let fake: FakePos | undefined;
let oneCHttp: PosProvider | undefined;
const overrides = new Map<string, PosProvider>();

const providers = (): Record<string, () => PosProvider | null> => ({
  "1c": () => (oneCHttp ??= createOneCHttpProvider(outboundFetch)),
  "1c-exchange": () => oneCExchangeProvider,
  fake: () => (env.NODE_ENV !== "production" ? (fake ??= createFakePos()) : null),
});

/** Names of the POS systems a location can be connected to here. */
export function availablePosProviders(): string[] {
  const names = Object.entries(providers())
    .filter(([, make]) => make() !== null)
    .map(([name]) => name);
  return [...new Set([...names, ...overrides.keys()])];
}

/** A POS adapter by name, or null if it isn't available here. */
export function findPosProvider(name: string): PosProvider | null {
  const override = overrides.get(name);
  if (override) return override;
  return Object.hasOwn(providers(), name) ? providers()[name]!() : null;
}

/** The development fake (tests drive it). */
export function fakePos(): FakePos | null {
  const provider = findPosProvider("fake");
  return provider && "failNext" in provider ? (provider as FakePos) : null;
}

/** Tests swap in their own adapter (undefined removes it). */
export function setPosProviderForTests(provider: PosProvider | undefined, name = provider?.name) {
  if (!name) return;
  if (provider) overrides.set(name, provider);
  else overrides.delete(name);
}
