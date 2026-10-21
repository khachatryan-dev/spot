import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { Bell } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { guardPage, requireUser } from "@/server/auth/guards";
import { listNotifications, markAllRead } from "@/server/services/notification-service";
import { formatMoney } from "@/shared/utils/money";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Notifications");
  return { title: t("title"), robots: { index: false } };
}

/** The signed-in person's notifications; opening the page marks them read (§27). */
export default async function NotificationsPage({ params }: PageProps<"/[locale]/notifications">) {
  const locale = await resolveLocale(params);
  const user = await guardPage(locale, requireUser);
  const items = await listNotifications(user);
  await markAllRead(user);
  const t = await getTranslations("Notifications");
  const format = await getFormatter();

  const text = (item: (typeof items)[number]) => {
    const d = item.data;
    const when =
      typeof d.startsAt === "string"
        ? format.dateTime(new Date(d.startsAt), {
            weekday: "short",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: typeof d.timezone === "string" ? d.timezone : undefined,
          })
        : "";
    const amount =
      typeof d.amountMinor === "number" && typeof d.currency === "string"
        ? formatMoney(d.amountMinor, d.currency, locale)
        : "";
    return t(`types.${item.type}`, {
      restaurant: String(d.restaurant ?? ""),
      guest: String(d.guest ?? ""),
      party: Number(d.party ?? 0),
      reason: String(d.reason ?? ""),
      when,
      amount,
    });
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="px-1 text-2xl font-bold">{t("title")}</h1>
      {items.length === 0 ? (
        <EmptyState icon={Bell}>{t("empty")}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("title")}>
          {items.map((item) => {
            const body = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-2xl",
                    item.readAt
                      ? "bg-muted text-muted-foreground"
                      : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
                  )}
                >
                  <Bell className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm">{text(item)}</span>
                  <span className="text-xs text-muted-foreground">
                    {format.relativeTime(item.createdAt)}
                  </span>
                </span>
                {!item.readAt && (
                  <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full bg-primary" />
                )}
              </>
            );
            const className =
              "flex items-start gap-3 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border";
            return (
              <li key={item.id}>
                {item.link ? (
                  <Link href={item.link} className={cn(className, "hover:bg-muted/50")}>
                    {!item.readAt && <span className="sr-only">{t("new")}</span>}
                    {body}
                  </Link>
                ) : (
                  <div className={className}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
