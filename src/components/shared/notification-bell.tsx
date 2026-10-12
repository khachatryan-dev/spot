import { Bell } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { unreadCount } from "@/server/services/notification-service";

/** Bell with the unread count, linking to the notifications page (§27). */
export async function NotificationBell({ userId }: { userId: string }) {
  const count = await unreadCount({ id: userId });
  const t = await getTranslations("Notifications");
  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? t("bellUnread", { count }) : t("bell")}
      className="relative inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
    >
      <Bell className="size-5" aria-hidden />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 font-semibold text-white"
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
