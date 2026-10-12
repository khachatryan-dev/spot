import "server-only";

import { eq, sql } from "drizzle-orm";

import type { Executor } from "@/server/db/client";
import { auditLogs, users } from "@/server/db/schema";
import type { AuditAction, AuditEntityType } from "@/shared/constants/audit";

export interface AuditEntry {
  /** Who did it; null for system actions. */
  actor: { id: string } | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  restaurantId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append an audit entry (§49 #14). Pass the same transaction as the change
 * itself, so the change and its record are committed together or not at all.
 */
export async function recordAudit(executor: Executor, entry: AuditEntry) {
  await executor.insert(auditLogs).values({
    actorUserId: entry.actor?.id ?? null,
    actorEmail: entry.actor
      ? sql`(${executor.select({ email: users.email }).from(users).where(eq(users.id, entry.actor.id))})`
      : null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    restaurantId: entry.restaurantId ?? null,
    metadata: entry.metadata ?? {},
  });
}
