import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

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
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("title")}>
          {items.map((item) => {
            const body = (
              <>
                <span className="text-sm">{text(item)}</span>
                <span className="text-xs text-muted-foreground">
                  {format.relativeTime(item.createdAt)}
                </span>
              </>
            );
            const className = cn(
              "flex flex-col gap-1 rounded-xl border p-3",
              !item.readAt && "border-l-4 border-l-primary",
            );
            return (
              <li key={item.id}>
                {item.link ? (
                  <Link href={item.link} className={cn(className, "hover:bg-muted")}>
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
