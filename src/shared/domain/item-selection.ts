/*
 * Choosing options for an item (§15). Shared by the item sheet in the browser
 * and order validation on the server, so both apply exactly the same rules.
 * All money is integer minor units.
 */

export interface SelectableModifier {
  id: string;
  priceDeltaMinor: number;
  isAvailable: boolean;
  isDefault: boolean;
}

export interface SelectableGroup {
  id: string;
  minSelect: number;
  maxSelect: number;
  modifiers: SelectableModifier[];
}

export const MAX_ITEM_QUANTITY = 50;

/** Starting choices: available defaults, never more than a group allows. */
export function defaultSelection(groups: SelectableGroup[]): string[] {
  return groups.flatMap((group) =>
    group.modifiers
      .filter((m) => m.isDefault && m.isAvailable)
      .slice(0, group.maxSelect)
      .map((m) => m.id),
  );
}

export type SelectionProblem =
  | { groupId: string; problem: "tooFew"; min: number }
  | { groupId: string; problem: "tooMany"; max: number }
  | { groupId: string; problem: "unavailable"; modifierId: string }
  | { groupId: null; problem: "unknownModifier"; modifierId: string }
  | { groupId: null; problem: "duplicate"; modifierId: string };

/** Everything wrong with a selection; an empty list means it can be ordered. */
export function selectionProblems(
  groups: SelectableGroup[],
  selectedIds: string[],
): SelectionProblem[] {
  const problems: SelectionProblem[] = [];
  const seen = new Set<string>();
  const byId = new Map(
    groups.flatMap((g) => g.modifiers.map((m) => [m.id, { group: g, modifier: m }] as const)),
  );

  for (const id of selectedIds) {
    if (seen.has(id)) problems.push({ groupId: null, problem: "duplicate", modifierId: id });
    seen.add(id);
    const found = byId.get(id);
    if (!found) problems.push({ groupId: null, problem: "unknownModifier", modifierId: id });
    else if (!found.modifier.isAvailable) {
      problems.push({ groupId: found.group.id, problem: "unavailable", modifierId: id });
    }
  }

  for (const group of groups) {
    const count = group.modifiers.filter((m) => seen.has(m.id)).length;
    if (count < group.minSelect)
      problems.push({ groupId: group.id, problem: "tooFew", min: group.minSelect });
    if (count > group.maxSelect)
      problems.push({ groupId: group.id, problem: "tooMany", max: group.maxSelect });
  }
  return problems;
}

/** Price of one unit: item price plus chosen options. */
export function unitPriceMinor(
  itemPriceMinor: number,
  groups: SelectableGroup[],
  selectedIds: string[],
): number {
  const selected = new Set(selectedIds);
  const extras = groups
    .flatMap((g) => g.modifiers)
    .filter((m) => selected.has(m.id))
    .reduce((sum, m) => sum + m.priceDeltaMinor, 0);
  return itemPriceMinor + extras;
}

/**
 * Toggle an option the way the sheet does: in a pick-one group, choosing
 * replaces the previous choice; otherwise it adds or removes (up to max).
 */
export function toggleModifier(
  groups: SelectableGroup[],
  selectedIds: string[],
  modifierId: string,
): string[] {
  const group = groups.find((g) => g.modifiers.some((m) => m.id === modifierId));
  const modifier = group?.modifiers.find((m) => m.id === modifierId);
  if (!group || !modifier?.isAvailable) return selectedIds;

  const inGroup = new Set(group.modifiers.map((m) => m.id));
  if (selectedIds.includes(modifierId)) {
    // A required pick-one choice can't be cleared, only replaced.
    if (group.maxSelect === 1 && group.minSelect >= 1) return selectedIds;
    return selectedIds.filter((id) => id !== modifierId);
  }
  if (group.maxSelect === 1) return [...selectedIds.filter((id) => !inGroup.has(id)), modifierId];
  const chosenInGroup = selectedIds.filter((id) => inGroup.has(id)).length;
  return chosenInGroup >= group.maxSelect ? selectedIds : [...selectedIds, modifierId];
}
