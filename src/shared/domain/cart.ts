import {
  MAX_ITEM_QUANTITY,
  type SelectableGroup,
  selectionProblems,
  unitPriceMinor,
} from "./item-selection";

/*
 * Cart rules (§16). A line stores *what* was chosen — never a price. Prices
 * and availability are resolved against the current menu every time, and the
 * server recalculates everything again when the order is placed.
 */

export interface CartLine {
  lineId: string;
  itemId: string;
  modifierIds: string[];
  quantity: number;
  note: string;
}

export type NewCartLine = Omit<CartLine, "lineId">;

const sameChoice = (a: NewCartLine, b: NewCartLine) =>
  a.itemId === b.itemId &&
  a.note === b.note &&
  a.modifierIds.length === b.modifierIds.length &&
  [...a.modifierIds].sort().join() === [...b.modifierIds].sort().join();

const clampQuantity = (quantity: number) =>
  Math.max(0, Math.min(MAX_ITEM_QUANTITY, Math.trunc(quantity)));

/** Add a line; the same item with the same options and note just adds quantity. */
export function addLine(lines: CartLine[], line: NewCartLine, newId: () => string): CartLine[] {
  const existing = lines.find((l) => sameChoice(l, line));
  if (existing) {
    return lines.map((l) =>
      l === existing ? { ...l, quantity: clampQuantity(l.quantity + line.quantity) } : l,
    );
  }
  return [...lines, { ...line, quantity: clampQuantity(line.quantity), lineId: newId() }].filter(
    (l) => l.quantity > 0,
  );
}

/** Change a quantity; 0 removes the line. */
export function setLineQuantity(lines: CartLine[], lineId: string, quantity: number): CartLine[] {
  return lines
    .map((l) => (l.lineId === lineId ? { ...l, quantity: clampQuantity(quantity) } : l))
    .filter((l) => l.quantity > 0);
}

export const removeLine = (lines: CartLine[], lineId: string) =>
  lines.filter((l) => l.lineId !== lineId);

export interface MenuItemForCart {
  id: string;
  name: string;
  priceMinor: number;
  unavailable: string | null;
  modifierGroups: (SelectableGroup & {
    modifiers: (SelectableGroup["modifiers"][number] & { name: string })[];
  })[];
}

export interface ResolvedCartLine extends CartLine {
  name: string;
  modifierNames: string[];
  unitPriceMinor: number;
  totalMinor: number;
  /** false if the item or a chosen option can't be ordered any more. */
  available: boolean;
}

/** Resolve lines against the current menu: names, current prices, availability, subtotal. */
export function resolveCart(lines: CartLine[], menu: Map<string, MenuItemForCart>) {
  const resolved: ResolvedCartLine[] = lines.map((line) => {
    const item = menu.get(line.itemId);
    if (!item) {
      return {
        ...line,
        name: "",
        modifierNames: [],
        unitPriceMinor: 0,
        totalMinor: 0,
        available: false,
      };
    }
    const modifiers = item.modifierGroups.flatMap((g) => g.modifiers);
    const available =
      item.unavailable === null &&
      selectionProblems(item.modifierGroups, line.modifierIds).length === 0;
    const unit = unitPriceMinor(item.priceMinor, item.modifierGroups, line.modifierIds);
    return {
      ...line,
      name: item.name,
      modifierNames: line.modifierIds
        .map((id) => modifiers.find((m) => m.id === id)?.name ?? "")
        .filter(Boolean),
      unitPriceMinor: unit,
      totalMinor: unit * line.quantity,
      available,
    };
  });
  const orderable = resolved.filter((l) => l.available);
  return {
    lines: resolved,
    subtotalMinor: orderable.reduce((sum, l) => sum + l.totalMinor, 0),
    itemCount: orderable.reduce((sum, l) => sum + l.quantity, 0),
    hasUnavailable: resolved.some((l) => !l.available),
  };
}
