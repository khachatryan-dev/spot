import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { AuditAction, AuditEntityType } from "@/shared/constants/audit";

/**
 * Append-only record of critical state changes (§49 #14). A trigger
 * (migration 0008) blocks UPDATE and DELETE. No foreign keys on purpose:
 * entries must outlive the users and records they mention.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Null for system actions. */
    actorUserId: uuid(),
    /** Snapshot, so the entry stays readable if the account is deleted. */
    actorEmail: text(),
    action: text().$type<AuditAction>().notNull(),
    entityType: text().$type<AuditEntityType>().notNull(),
    entityId: uuid().notNull(),
    /** Tenant the change belongs to, for per-restaurant activity views. */
    restaurantId: uuid(),
    /** What changed: e.g. { from, to }, { reason }, { fields }. Never secrets. */
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("audit_logs_occurred_at_idx").on(table.occurredAt),
    index("audit_logs_restaurant_idx").on(table.restaurantId, table.occurredAt),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_actor_idx").on(table.actorUserId),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
