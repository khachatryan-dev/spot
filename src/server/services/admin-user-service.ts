import "server-only";

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { restaurants, restaurantStaff, sessions, users } from "@/server/db/schema";
import { authorizePlatform } from "@/server/policies/restaurant-access";
import { AppError } from "@/shared/errors";

/*
 * User management for platform admins (platform:users:manage): find people,
 * see their restaurants and roles, suspend or restore accounts. Suspension
 * is enforced at sign-in and on every session read (auth.ts, session.ts);
 * here it also ends open sessions at once. History is never deleted.
 */

type Admin = Pick<SessionUser, "id" | "platformRole">;

export interface AdminUserRow {
  id: string;
  name: string | null;
  email: string;
  platformRole: "customer" | "platform_admin";
  status: "active" | "suspended";
  createdAt: Date;
  lastLoginAt: Date | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  /** Restaurants this person works at, with their role. */
  staff: { restaurantId: string; restaurantName: string; role: string; status: string }[];
}

export const USER_FILTERS = ["all", "suspended", "admins", "staff"] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

export async function listUsers(
  admin: Admin,
  options: { search?: string; filter?: UserFilter; limit?: number } = {},
): Promise<{ users: AdminUserRow[]; total: number }> {
  authorizePlatform(admin, "platform:users:manage");
  const search = options.search?.trim().slice(0, 100);
  const pattern = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const filter = options.filter ?? "all";
  const where = and(
    pattern ? or(ilike(users.email, pattern), ilike(users.name, pattern)) : undefined,
    filter === "suspended" ? eq(users.status, "suspended") : undefined,
    filter === "admins" ? eq(users.platformRole, "platform_admin") : undefined,
    filter === "staff"
      ? sql`EXISTS (SELECT 1 FROM restaurant_staff rs WHERE rs.user_id = ${users.id})`
      : undefined,
  );
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        platformRole: users.platformRole,
        status: users.status,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        suspendedAt: users.suspendedAt,
        suspensionReason: users.suspensionReason,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(Math.min(options.limit ?? 50, 200)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(where),
  ]);
  const staff = rows.length
    ? await db
        .select({
          userId: restaurantStaff.userId,
          restaurantId: restaurants.id,
          restaurantName: restaurants.name,
          role: restaurantStaff.role,
          status: restaurantStaff.status,
        })
        .from(restaurantStaff)
        .innerJoin(restaurants, eq(restaurants.id, restaurantStaff.restaurantId))
        .where(
          inArray(
            restaurantStaff.userId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return {
    users: rows.map((r) => ({
      ...r,
      staff: staff
        .filter((s) => s.userId === r.id)
        .map((s) => ({
          restaurantId: s.restaurantId,
          restaurantName: s.restaurantName,
          role: s.role,
          status: s.status,
        })),
    })),
    total: count!.total,
  };
}

const reasonSchema = z.string().trim().min(5, "reasonTooShort").max(500, "reasonTooLong");

/**
 * Suspend (with a reason) or restore an account. Admins can't suspend
 * themselves or the last active platform admin.
 */
export async function setUserStatus(
  admin: Admin,
  userId: string,
  input: { status: "active" | "suspended"; reason?: string },
) {
  authorizePlatform(admin, "platform:users:manage");
  if (!z.uuid().safeParse(userId).success) throw new AppError("NOT_FOUND", "User not found.");
  const reason = input.status === "suspended" ? reasonSchema.parse(input.reason ?? "") : null;
  if (input.status === "suspended" && userId === admin.id) {
    throw new AppError("CONFLICT", "You can't suspend your own account.");
  }

  await db.transaction(async (tx) => {
    // Suspending: lock every platform admin first, always in the same order,
    // so two admins suspending each other queue up instead of deadlocking.
    const admins =
      input.status === "suspended"
        ? await tx
            .select({ id: users.id, status: users.status })
            .from(users)
            .where(eq(users.platformRole, "platform_admin"))
            .orderBy(asc(users.id))
            .for("update")
        : [];
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user) throw new AppError("NOT_FOUND", "User not found.");
    if (user.status === input.status) return;
    if (input.status === "suspended" && user.platformRole === "platform_admin") {
      const others = admins.filter((a) => a.status === "active" && a.id !== user.id);
      if (others.length === 0) {
        throw new AppError("CONFLICT", "The last platform admin can't be suspended.");
      }
    }
    await tx
      .update(users)
      .set(
        input.status === "suspended"
          ? { status: "suspended", suspendedAt: new Date(), suspensionReason: reason }
          : { status: "active", suspendedAt: null, suspensionReason: null },
      )
      .where(eq(users.id, user.id));
    // Signed out everywhere, right now.
    if (input.status === "suspended") await tx.delete(sessions).where(eq(sessions.userId, user.id));
    await recordAudit(tx, {
      actor: admin,
      action: input.status === "suspended" ? "user.suspended" : "user.restored",
      entityType: "user",
      entityId: user.id,
      metadata: { email: user.email, ...(reason && { reason }) },
    });
  });
}
