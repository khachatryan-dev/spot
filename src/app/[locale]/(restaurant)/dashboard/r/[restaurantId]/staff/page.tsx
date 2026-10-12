import { getTranslations } from "next-intl/server";

import { InviteForm } from "@/features/restaurant-staff/invite-form";
import { StaffList } from "@/features/restaurant-staff/staff-list";
import { resolveLocale } from "@/i18n/locale";
import { guardPage, requireUser } from "@/server/auth/guards";
import { getRestaurantAccess } from "@/server/policies/restaurant-access";
import { listInvitations, listStaff } from "@/server/services/staff-service";
import { roleHasPermission } from "@/shared/auth/permissions";

export default async function StaffPage({
  params,
}: PageProps<"/[locale]/dashboard/r/[restaurantId]/staff">) {
  const locale = await resolveLocale(params);
  const { restaurantId } = await params;
  const data = await guardPage(locale, async () => {
    const user = await requireUser();
    const members = await listStaff(user, restaurantId);
    const access = await getRestaurantAccess(user.id, restaurantId);
    const canManage =
      !!access &&
      roleHasPermission(access.role, "staff:manage") &&
      access.restaurantStatus !== "closed";
    const invitations = canManage ? await listInvitations(user, restaurantId) : [];
    return { user, members, invitations, canManage };
  });
  const t = await getTranslations("Staff");

  return (
    <div className="flex flex-col gap-8">
      <StaffList
        restaurantId={restaurantId}
        members={data.members}
        invitations={data.invitations}
        currentUserEmail={data.user.email}
        canManage={data.canManage}
      />
      {data.canManage && (
        <section className="flex flex-col gap-4 border-t pt-6" aria-labelledby="invite">
          <div className="flex flex-col gap-1">
            <h2 id="invite" className="text-lg font-medium">
              {t("invite.title")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("invite.subtitle")}</p>
          </div>
          <InviteForm restaurantId={restaurantId} />
        </section>
      )}
    </div>
  );
}
