import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserStatusActions } from "@/features/admin-users/user-status-actions";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { guardPage, requirePlatformPermission } from "@/server/auth/guards";
import { listUsers, USER_FILTERS, type UserFilter } from "@/server/services/admin-user-service";

/** Platform admins find and manage accounts. */
export default async function AdminUsersPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/users">) {
  const locale = await resolveLocale(params);
  const { q, filter: rawFilter } = await searchParams;
  const search = typeof q === "string" ? q : "";
  const filter = (USER_FILTERS as readonly string[]).includes(String(rawFilter))
    ? (rawFilter as UserFilter)
    : "all";
  const { me, result } = await guardPage(locale, async () => {
    const me = await requirePlatformPermission("platform:users:manage");
    return { me, result: await listUsers(me, { search, filter }) };
  });
  const t = await getTranslations("AdminUsers");
  const roles = await getTranslations("Onboarding.dashboard.roles");
  const format = await getFormatter();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <form role="search" className="flex gap-2">
        <input type="hidden" name="filter" value={filter} />
        <label htmlFor="q" className="sr-only">
          {t("search")}
        </label>
        <Input id="q" name="q" defaultValue={search} placeholder={t("searchPlaceholder")} />
        <Button type="submit" variant="secondary">
          {t("search")}
        </Button>
      </form>
      <nav aria-label={t("filtersLabel")} className="flex flex-wrap gap-2">
        {USER_FILTERS.map((f) => (
          <Link
            key={f}
            href={{ pathname: "/admin/users", query: { filter: f, ...(search && { q: search }) } }}
            aria-current={f === filter ? "page" : undefined}
            className="rounded-full border px-3 py-1 text-sm aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
          >
            {t(`filters.${f}`)}
          </Link>
        ))}
      </nav>
      <p role="status" className="text-sm text-muted-foreground">
        {t("count", { count: result.total })}
      </p>
      <ul className="flex flex-col gap-3" aria-label={t("listLabel")}>
        {result.users.map((user) => {
          const who = user.name ?? user.email;
          return (
            <li key={user.id} className="flex flex-col gap-2 rounded-2xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-col">
                  <span className="font-semibold">{who}</span>
                  <span className="text-sm text-muted-foreground">{user.email}</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  {user.platformRole === "platform_admin" && <Badge>{t("admin")}</Badge>}
                  {user.status === "suspended" && (
                    <Badge variant="outline">{t("suspendedBadge")}</Badge>
                  )}
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                {t("joined", { date: format.dateTime(user.createdAt, { dateStyle: "medium" }) })}
                {" · "}
                {user.lastLoginAt
                  ? t("lastLogin", {
                      date: format.dateTime(user.lastLoginAt, { dateStyle: "medium" }),
                    })
                  : t("neverLoggedIn")}
              </span>
              {user.staff.length > 0 && (
                <ul className="flex flex-wrap gap-2 text-sm">
                  {user.staff.map((s) => (
                    <li key={s.restaurantId}>
                      <Link
                        href={`/admin/restaurants/${s.restaurantId}`}
                        className="rounded-md border px-2 py-0.5 hover:bg-muted"
                      >
                        {s.restaurantName} · {roles(s.role as "owner")}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {user.status === "suspended" && user.suspensionReason && (
                <p className="rounded-lg bg-destructive/10 p-2 text-sm">
                  {t("reasonShown", { reason: user.suspensionReason })}
                </p>
              )}
              {user.id !== me.id && (
                <div>
                  <UserStatusActions userId={user.id} who={who} status={user.status} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
