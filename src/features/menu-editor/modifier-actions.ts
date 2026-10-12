"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import {
  createModifier,
  createModifierGroup,
  deleteModifier,
  deleteModifierGroup,
  reorder,
  setModifierAvailability,
  updateModifier,
  updateModifierGroup,
} from "@/server/services/menu-service";
import type { ModifierGroupInput, ModifierInput } from "@/shared/schemas/menu";

const ok = { ok: true } as const;

export async function createModifierGroupAction(
  restaurantId: string,
  itemId: string,
  input: ModifierGroupInput,
) {
  return action(async () => {
    await createModifierGroup(await requireUser(), restaurantId, itemId, input);
    return ok;
  });
}

export async function updateModifierGroupAction(
  restaurantId: string,
  groupId: string,
  input: Partial<ModifierGroupInput>,
) {
  return action(async () => {
    await updateModifierGroup(await requireUser(), restaurantId, groupId, input);
    return ok;
  });
}

export async function deleteModifierGroupAction(restaurantId: string, groupId: string) {
  return action(async () => {
    await deleteModifierGroup(await requireUser(), restaurantId, groupId);
    return ok;
  });
}

export async function createModifierAction(
  restaurantId: string,
  groupId: string,
  input: ModifierInput,
) {
  return action(async () => {
    await createModifier(await requireUser(), restaurantId, groupId, input);
    return ok;
  });
}

export async function updateModifierAction(
  restaurantId: string,
  modifierId: string,
  input: Partial<ModifierInput>,
) {
  return action(async () => {
    await updateModifier(await requireUser(), restaurantId, modifierId, input);
    return ok;
  });
}

export async function setModifierAvailabilityAction(
  restaurantId: string,
  modifierId: string,
  isAvailable: boolean,
) {
  return action(async () => {
    await setModifierAvailability(await requireUser(), restaurantId, modifierId, isAvailable);
    return ok;
  });
}

export async function deleteModifierAction(restaurantId: string, modifierId: string) {
  return action(async () => {
    await deleteModifier(await requireUser(), restaurantId, modifierId);
    return ok;
  });
}

export async function reorderModifierGroupsAction(
  restaurantId: string,
  itemId: string,
  orderedIds: string[],
) {
  return action(async () => {
    await reorder(await requireUser(), restaurantId, "modifierGroups", itemId, orderedIds);
    return ok;
  });
}

export async function reorderModifiersAction(
  restaurantId: string,
  groupId: string,
  orderedIds: string[],
) {
  return action(async () => {
    await reorder(await requireUser(), restaurantId, "modifiers", groupId, orderedIds);
    return ok;
  });
}
