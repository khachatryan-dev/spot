import { ScrollText } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/shared/empty-state";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requirePlatformPermission } from "@/server/auth/guards";
import { listAuditLog } from "@/server/services/audit-service";

/** Short, readable summary of an entry's metadata. */
function summarize(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof metadata.from === "string" && typeof metadata.to === "string") {
    parts.push(`${metadata.from} → ${metadata.to}`);
  }
  if (Array.isArray(metadata.fields)) parts.push(metadata.fields.join(", "));
  for (const key of ["email", "role", "kind", "change"] as const) {
    if (typeof metadata[key] === "string") parts.push(String(metadata[key]));
  }
  if (typeof metadata.reason === "string") parts.push(`“${metadata.reason}”`);
  return parts.join(" · ");
}

export default async function AdminAuditPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/audit">) {
  const locale = await resolveLocale(params);
  const { restaurant } = await searchParams;
  const entries = await guardPage(locale, async () =>
    listAuditLog(await requirePlatformPermission("platform:audit:read"), {
      restaurantId: typeof restaurant === "string" ? restaurant : undefined,
    }),
  );
  const t = await getTranslations("Admin.audit");
  const format = await getFormatter();

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {typeof restaurant === "string" && (
          <Link href="/admin/audit" className="text-sm underline-offset-4 hover:underline">
            {t("showAll")}
          </Link>
        )}
      </div>
      {entries.length === 0 ? (
        <EmptyState icon={ScrollText}>{t("empty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th scope="col" className="p-3 font-medium">
                  {t("when")}
                </th>
                <th scope="col" className="p-3 font-medium">
                  {t("who")}
                </th>
                <th scope="col" className="p-3 font-medium">
                  {t("what")}
                </th>
                <th scope="col" className="p-3 font-medium">
                  {t("restaurant")}
                </th>
                <th scope="col" className="p-3 font-medium">
                  {t("details")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="p-3 whitespace-nowrap text-muted-foreground">
                    {format.dateTime(entry.occurredAt, { dateStyle: "short", timeStyle: "medium" })}
                  </td>
                  <td className="p-3">{entry.actorEmail ?? t("system")}</td>
                  <td className="p-3 font-mono text-xs">{entry.action}</td>
                  <td className="p-3">
                    {entry.restaurantId ? (
                      <Link
                        href={{
                          pathname: "/admin/audit",
                          query: { restaurant: entry.restaurantId },
                        }}
                        className="underline-offset-4 hover:underline"
                      >
                        {entry.restaurantName ?? entry.restaurantId.slice(0, 8)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">{summarize(entry.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
