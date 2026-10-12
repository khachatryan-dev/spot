import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import {
  emailMessages,
  type Notification,
  notifications,
  restaurantStaff,
  users,
} from "@/server/db/schema";
import { emailSender } from "@/server/email/sender";
import { type EmailLocale, type EmailTemplate, renderEmail } from "@/server/email/templates";
import { logger } from "@/server/logger";
import { RESTAURANT_ROLE_PERMISSIONS, type RestaurantPermission } from "@/shared/auth/permissions";
import type { NotificationType } from "@/shared/constants/notifications";
import { RESTAURANT_ROLES } from "@/shared/constants/roles";

/*
 * Notifications (§27): in-app notices for signed-in people, and emails.
 * Called after the change they describe has been committed; failures are
 * logged and never undo or block that change.
 */

type Actor = Pick<SessionUser, "id">;
const log = logger.child({ module: "notifications" });

export interface Notice {
  type: NotificationType;
  restaurantId?: string | null;
  data?: Record<string, string | number>;
  link?: string | null;
}

/** Give these people an in-app notice. */
export async function notify(userIds: string[], notice: Notice) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  try {
    await db.insert(notifications).values(
      unique.map((userId) => ({
        userId,
        type: notice.type,
        restaurantId: notice.restaurantId ?? null,
        data: notice.data ?? {},
        link: notice.link ?? null,
      })),
    );
  } catch (err) {
    log.error("Couldn't save notifications", { err, type: notice.type });
  }
}

/** Active staff at a restaurant whose role has `permission` (e.g. who answers bookings). */
export async function staffWith(restaurantId: string, permission: RestaurantPermission) {
  const roles = RESTAURANT_ROLES.filter((role) =>
    RESTAURANT_ROLE_PERMISSIONS[role].has(permission),
  );
  const rows = await db
    .select({ userId: restaurantStaff.userId })
    .from(restaurantStaff)
    .where(
      and(
        eq(restaurantStaff.restaurantId, restaurantId),
        eq(restaurantStaff.status, "active"),
        inArray(restaurantStaff.role, roles),
      ),
    );
  return rows.map((r) => r.userId);
}

/** A person's email and language, for emailing them. */
export async function recipientOf(userId: string | null) {
  if (!userId) return null;
  const [user] = await db
    .select({ email: users.email, name: users.name, preferredLocale: users.preferredLocale })
    .from(users)
    .where(eq(users.id, userId));
  return user ?? null;
}

/**
 * Send an email: recorded first, then handed to the email service (or
 * logged when none is configured). Never throws.
 */
export async function sendEmail(input: {
  to: string;
  template: EmailTemplate;
  locale: EmailLocale;
  values: Record<string, string | number>;
  action?: { url: string };
}) {
  try {
    const email = renderEmail(input.template, input.locale, input.values, input.action);
    const [row] = await db
      .insert(emailMessages)
      .values({
        to: input.to,
        template: input.template,
        locale: input.locale,
        subject: email.subject,
      })
      .returning({ id: emailMessages.id });
    const sender = emailSender();
    try {
      await sender.send({ to: input.to, ...email });
      await db
        .update(emailMessages)
        .set({ status: sender.name === "log" ? "logged" : "sent", attempts: 1, sentAt: new Date() })
        .where(eq(emailMessages.id, row!.id));
    } catch (err) {
      log.error("Email delivery failed", { err, template: input.template });
      await db
        .update(emailMessages)
        .set({ status: "failed", attempts: 1, lastError: String(err).slice(0, 500) })
        .where(eq(emailMessages.id, row!.id));
    }
  } catch (err) {
    log.error("Couldn't prepare email", { err, template: input.template });
  }
}

/** The latest notices of the signed-in person. */
export async function listNotifications(actor: Actor, limit = 50): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, actor.id))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function unreadCount(actor: Actor): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));
  return row!.count;
}

export async function markAllRead(actor: Actor) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));
}
