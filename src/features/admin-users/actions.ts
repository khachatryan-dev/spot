"use server";

import { requirePlatformPermission } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import { setUserStatus } from "@/server/services/admin-user-service";

export async function setUserStatusAction(
  userId: string,
  status: "active" | "suspended",
  reason?: string,
) {
  return action(async () => {
    await setUserStatus(await requirePlatformPermission("platform:users:manage"), userId, {
      status,
      reason,
    });
    return { status };
  });
}
