"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useApiError } from "@/components/shared/use-api-error";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import type { RestaurantRole } from "@/shared/constants/roles";
import type { ApiResult } from "@/shared/errors";

import { changeStaffRoleAction, removeStaffAction, revokeInvitationAction } from "./actions";
import { RoleSelect } from "./role-select";

interface Member {
  id: string;
  name: string | null;
  email: string;
  role: RestaurantRole;
}
interface Invitation {
  id: string;
  email: string;
  role: RestaurantRole;
}

export function StaffList({
  restaurantId,
  members,
  invitations,
  currentUserEmail,
  canManage,
}: {
  restaurantId: string;
  members: Member[];
  invitations: Invitation[];
  currentUserEmail: string;
  canManage: boolean;
}) {
  const t = useTranslations("Staff");
  const roles = useTranslations("Onboarding.dashboard.roles");
  const apiError = useApiError();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, task: () => Promise<ApiResult<unknown>>, success: string) {
    setBusy(id);
    const result = await task();
    setBusy(null);
    if (result.error) {
      toast.error(apiError.message(result.error));
    } else {
      toast.success(success);
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col divide-y rounded-xl border" aria-label={t("membersTitle")}>
        {members.map((member) => (
          <li key={member.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">
                {member.name ?? member.email}
                {member.email === currentUserEmail && (
                  <span className="text-muted-foreground"> · {t("you")}</span>
                )}
              </span>
              <span className="truncate text-sm text-muted-foreground">{member.email}</span>
            </div>
            {canManage ? (
              <>
                <RoleSelect
                  aria-label={t("roleFor", { name: member.name ?? member.email })}
                  value={member.role}
                  disabled={busy === member.id}
                  onChange={(role) =>
                    run(
                      member.id,
                      () => changeStaffRoleAction(restaurantId, member.id, role),
                      t("roleChanged"),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("remove", { name: member.name ?? member.email })}
                  disabled={busy === member.id}
                  onClick={() => {
                    if (!window.confirm(t("removeConfirm", { name: member.name ?? member.email })))
                      return;
                    void run(
                      member.id,
                      () => removeStaffAction(restaurantId, member.id),
                      t("removed"),
                    );
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </>
            ) : (
              <span className="text-sm">{roles(member.role)}</span>
            )}
          </li>
        ))}
      </ul>

      {canManage && invitations.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="pending-invitations">
          <h3 id="pending-invitations" className="font-medium">
            {t("pendingTitle")}
          </h3>
          <ul className="flex flex-col divide-y rounded-xl border border-dashed">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center gap-3 p-4">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{invitation.email}</span>
                  <span className="text-sm text-muted-foreground">{roles(invitation.role)}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === invitation.id}
                  onClick={() =>
                    run(
                      invitation.id,
                      () => revokeInvitationAction(restaurantId, invitation.id),
                      t("revoked"),
                    )
                  }
                >
                  {t("revoke")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
