import { selectionProblems } from "@/shared/domain/item-selection";
import { AppError } from "@/shared/errors";
import type { ParsedOrderRequest } from "@/shared/schemas/order";

/*
 * Server-side order pricing (§16, §49 #3). Pure: given what the guest asked
 * for and the authoritative catalog, produce the snapshot to store. Prices,
 * names and availability come only from the catalog — never the request.
 */

/** Largest order total we accept (fits the integer column with room to spare). */
export const MAX_ORDER_TOTAL_MINOR = 1_000_000_000;

export interface CatalogModifier {
  id: string;
  name: string;
  priceDeltaMinor: number;
  isAvailable: boolean;
  isDefault: boolean;
}

export interface CatalogItem {
  id: string;
  name: string;
  priceMinor: number;
  /** null = orderable now; otherwise why not. */
  unavailable: string | null;
  modifierGroups: CatalogGroup[];
}

/** Structurally a SelectableGroup, plus names for the snapshot. */
export interface CatalogGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: CatalogModifier[];
}

/** Items that can appear on an order right now, by id. Anything missing can't be ordered. */
export type Catalog = Map<string, CatalogItem>;

export interface PricedModifier {
  modifierId: string;
  groupName: string;
  name: string;
  priceDeltaMinor: number;
}

export interface PricedLine {
  menuItemId: string;
  name: string;
  unitPriceMinor: number;
  modifiersTotalMinor: number;
  quantity: number;
  lineTotalMinor: number;
  note: string | null;
  modifiers: PricedModifier[];
}

export interface PricedOrder {
  lines: PricedLine[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
}

export type LineProblem = "itemUnavailable" | "outOfStock" | "optionsInvalid";

/** Why line `i` can't be ordered, keyed "lines.i" for the client. */
function lineProblem(
  line: ParsedOrderRequest["lines"][number],
  item: CatalogItem | undefined,
): LineProblem | null {
  if (!item) return "itemUnavailable";
  if (item.unavailable === "outOfStock") return "outOfStock";
  if (item.unavailable) return "itemUnavailable";
  return selectionProblems(item.modifierGroups, line.modifierIds).length > 0
    ? "optionsInvalid"
    : null;
}

/**
 * Price a parsed order request against the catalog. Throws ORDER_UNAVAILABLE
 * with per-line field errors if anything can't be ordered as asked.
 */
export function priceOrder(request: ParsedOrderRequest, catalog: Catalog): PricedOrder {
  const fieldErrors: Record<string, string[]> = {};
  request.lines.forEach((line, index) => {
    const problem = lineProblem(line, catalog.get(line.itemId));
    if (problem) fieldErrors[`lines.${index}`] = [problem];
  });
  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError("ORDER_UNAVAILABLE", "Some items can't be ordered right now.", {
      fieldErrors,
    });
  }

  const lines = request.lines.map((line): PricedLine => {
    const item = catalog.get(line.itemId)!;
    const chosen = new Set(line.modifierIds);
    const modifiers = item.modifierGroups.flatMap((group) =>
      group.modifiers
        .filter((m) => chosen.has(m.id))
        .map((m) => ({
          modifierId: m.id,
          groupName: group.name,
          name: m.name,
          priceDeltaMinor: m.priceDeltaMinor,
        })),
    );
    const modifiersTotalMinor = modifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0);
    return {
      menuItemId: item.id,
      name: item.name,
      unitPriceMinor: item.priceMinor,
      modifiersTotalMinor,
      quantity: line.quantity,
      lineTotalMinor: (item.priceMinor + modifiersTotalMinor) * line.quantity,
      note: line.note || null,
      modifiers,
    };
  });

  const subtotalMinor = lines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor > MAX_ORDER_TOTAL_MINOR) {
    throw new AppError("ORDER_UNAVAILABLE", "This order is too large.", {
      fieldErrors: { lines: ["orderTooLarge"] },
    });
  }
  // Promotions (§16 step 8) arrive later; until then there is no discount.
  const discountMinor = 0;
  return { lines, subtotalMinor, discountMinor, totalMinor: subtotalMinor - discountMinor };
}
