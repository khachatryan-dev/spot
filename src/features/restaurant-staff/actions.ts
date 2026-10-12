"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import {
  acceptInvitation,
  changeStaffRole,
  inviteStaff,
  removeStaff,
  revokeInvitation,
} from "@/server/services/staff-service";
import type { RestaurantRole } from "@/shared/constants/roles";
import type { InviteStaffInput } from "@/shared/schemas/staff";

export async function inviteStaffAction(restaurantId: string, input: InviteStaffInput) {
  return action(async () => {
    const { token } = await inviteStaff(await requireUser(), restaurantId, input);
    return { token };
  });
}

export async function revokeInvitationAction(restaurantId: string, invitationId: string) {
  return action(async () => {
    await revokeInvitation(await requireUser(), restaurantId, invitationId);
    return { ok: true };
  });
}

export async function changeStaffRoleAction(
  restaurantId: string,
  memberId: string,
  role: RestaurantRole,
) {
  return action(async () => {
    await changeStaffRole(await requireUser(), restaurantId, memberId, { role });
    return { ok: true };
  });
}

export async function removeStaffAction(restaurantId: string, memberId: string) {
  return action(async () => {
    await removeStaff(await requireUser(), restaurantId, memberId);
    return { ok: true };
  });
}

export async function acceptInvitationAction(token: string) {
  return action(async () => acceptInvitation(await requireUser(), token));
}
