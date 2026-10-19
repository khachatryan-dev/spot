"use server";

import { requirePlatformPermission } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import { setContactMessageStatus } from "@/server/services/contact-service";
import type { ContactStatus } from "@/shared/constants/contact";

export async function setContactMessageStatusAction(messageId: string, status: ContactStatus) {
  return action(async () => {
    const admin = await requirePlatformPermission("platform:messages:manage");
    await setContactMessageStatus(admin, messageId, status);
    return { ok: true };
  });
}
