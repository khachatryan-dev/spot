import "server-only";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { auditLogs, restaurants } from "@/server/db/schema";
import { authorizePlatform } from "@/server/policies/restaurant-access";

/** Latest audit entries for platform admins, optionally for one restaurant. */
export async function listAuditLog(
  admin: Pick<SessionUser, "platformRole">,
  options: { restaurantId?: string; limit?: number } = {},
) {
  authorizePlatform(admin, "platform:audit:read");
  const restaurantId = z.uuid().safeParse(options.restaurantId).success
    ? options.restaurantId
    : undefined;
  return db
    .select({
      id: auditLogs.id,
      occurredAt: auditLogs.occurredAt,
      action: auditLogs.action,
      actorEmail: auditLogs.actorEmail,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      restaurantId: auditLogs.restaurantId,
      restaurantName: restaurants.name,
      metadata: auditLogs.metadata,
    })
    .from(auditLogs)
    .leftJoin(restaurants, eq(restaurants.id, auditLogs.restaurantId))
    .where(restaurantId ? eq(auditLogs.restaurantId, restaurantId) : undefined)
    .orderBy(desc(auditLogs.occurredAt))
    .limit(Math.min(options.limit ?? 100, 500));
}
