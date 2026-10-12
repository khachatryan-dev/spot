"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  addLine,
  type CartLine,
  type NewCartLine,
  removeLine,
  setLineQuantity,
} from "@/shared/domain/cart";

/** Carts older than this are dropped (the table visit is over by then). */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface CartState {
  /** One cart per table session, so another visit never sees these lines. */
  carts: Record<string, { lines: CartLine[]; updatedAt: number }>;
  add: (sessionId: string, line: NewCartLine) => void;
  setQuantity: (sessionId: string, lineId: string, quantity: number) => void;
  remove: (sessionId: string, lineId: string) => void;
  clear: (sessionId: string) => void;
}

const update = (state: CartState, sessionId: string, fn: (lines: CartLine[]) => CartLine[]) => ({
  carts: {
    ...state.carts,
    [sessionId]: { lines: fn(state.carts[sessionId]?.lines ?? []), updatedAt: Date.now() },
  },
});

/** Local, per-browser cart (Zustand, §5). Stores choices only — never prices. */
export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      carts: {},
      add: (sessionId, line) =>
        set((s) =>
          update(s, sessionId, (lines) => addLine(lines, line, () => crypto.randomUUID())),
        ),
      setQuantity: (sessionId, lineId, quantity) =>
        set((s) => update(s, sessionId, (lines) => setLineQuantity(lines, lineId, quantity))),
      remove: (sessionId, lineId) =>
        set((s) => update(s, sessionId, (lines) => removeLine(lines, lineId))),
      clear: (sessionId) => set((s) => update(s, sessionId, () => [])),
    }),
    {
      name: "spot-cart",
      version: 1,
      // localStorage can be unavailable (private mode); then the cart just isn't kept across reloads.
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const now = Date.now();
        state.carts = Object.fromEntries(
          Object.entries(state.carts).filter(([, c]) => now - c.updatedAt < MAX_AGE_MS),
        );
      },
    },
  ),
);
