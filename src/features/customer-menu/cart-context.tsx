"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

import type { CustomerMenu } from "@/server/services/customer-menu-service";
import { type MenuItemForCart, resolveCart } from "@/shared/domain/cart";

import { useCartStore } from "./cart-store";

interface CartContextValue {
  sessionId: string;
  currency: string;
  menu: Map<string, MenuItemForCart>;
}

const CartContext = createContext<CartContextValue | null>(null);

/** Ties the cart to the current table session and today's menu. */
export function CartScope({
  sessionId,
  currency,
  menus,
  children,
}: {
  sessionId: string;
  currency: string;
  menus: CustomerMenu[];
  children: React.ReactNode;
}) {
  const menu = useMemo(
    () =>
      new Map(
        menus.flatMap((m) =>
          m.categories.flatMap((c) => c.items.map((item) => [item.id, item] as const)),
        ),
      ),
    [menus],
  );
  return (
    <CartContext.Provider value={{ sessionId, currency, menu }}>{children}</CartContext.Provider>
  );
}

const subscribe = () => () => {};
/** False during server render and hydration, so persisted carts don't cause mismatches. */
export const useHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside <CartScope>");
  const { sessionId, menu, currency } = context;
  const lines = useCartStore((s) => s.carts[sessionId]?.lines);
  const actions = useCartStore.getState();
  const cart = useMemo(() => resolveCart(lines ?? [], menu), [lines, menu]);
  return {
    ...cart,
    currency,
    add: (line: Parameters<typeof actions.add>[1]) => actions.add(sessionId, line),
    setQuantity: (lineId: string, quantity: number) =>
      actions.setQuantity(sessionId, lineId, quantity),
    remove: (lineId: string) => actions.remove(sessionId, lineId),
    clear: () => actions.clear(sessionId),
  };
}
