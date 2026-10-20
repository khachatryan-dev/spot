import { Inbox } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { MessageStatusButton } from "@/features/admin-messages/message-status-button";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requirePlatformPermission } from "@/server/auth/guards";
import { listContactMessages } from "@/server/services/contact-service";
import type { ContactStatus } from "@/shared/constants/contact";

/** Messages from the public contact form: new first, handled on their own tab. */
export default async function AdminMessagesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/messages">) {
  const locale = await resolveLocale(params);
  const { status: requested } = await searchParams;
  const status: ContactStatus = requested === "handled" ? "handled" : "new";
  const messages = await guardPage(locale, async () =>
    listContactMessages(await requirePlatformPermission("platform:messages:manage"), status),
  );
  const t = await getTranslations("AdminMessages");
  const topics = await getTranslations("Contact.form.topics");
  const format = await getFormatter();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <nav aria-label={t("filter")} className="flex gap-2">
        {(["new", "handled"] as const).map((s) => (
          <Link
            key={s}
            href={s === "new" ? "/admin/messages" : "/admin/messages?status=handled"}
            aria-current={s === status ? "page" : undefined}
            className="rounded-full bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-orange-100 aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground dark:hover:bg-orange-900/40"
          >
            {t(`tabs.${s}`)}
          </Link>
        ))}
      </nav>
      {messages.length === 0 ? (
        <EmptyState icon={Inbox}>{t(`empty.${status}`)}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{m.name}</span>
                <Badge variant="outline">{topics(m.topic)}</Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {format.dateTime(m.createdAt, { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                <a href={`mailto:${m.email}`} className="hover:text-primary hover:underline">
                  {m.email}
                </a>{" "}
                · {m.locale.toUpperCase()}
              </span>
              <p className="text-sm whitespace-pre-line">{m.message}</p>
              <MessageStatusButton messageId={m.id} name={m.name} status={m.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
