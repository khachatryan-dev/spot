import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { type ContactMessage, contactMessages } from "@/server/db/schema";
import { authorizePlatform } from "@/server/policies/restaurant-access";
import { hitRateLimit } from "@/server/rate-limit/rate-limit";
import type { ContactStatus } from "@/shared/constants/contact";
import { type ContactInput, contactSchema } from "@/shared/schemas/contact";
import { AppError } from "@/shared/errors";

/*
 * The public contact form: anyone may write (rate-limited per IP), platform
 * admins read the messages and mark them handled. Replies go by email from
 * the admin's own mailbox until an email service is chosen.
 */

type Admin = Pick<SessionUser, "id" | "platformRole">;

export const CONTACT_LIMIT = { max: 5, windowMs: 60 * 60_000 };

export async function sendContactMessage(
  input: ContactInput,
  context: { ip: string; locale: string; userId?: string | null },
): Promise<ContactMessage> {
  const data = contactSchema.parse(input);
  if (!(await hitRateLimit(`contact:${context.ip}`, CONTACT_LIMIT)).allowed) {
    throw new AppError("RATE_LIMITED");
  }
  const [message] = await db
    .insert(contactMessages)
    .values({ ...data, locale: context.locale, userId: context.userId ?? null })
    .returning();
  return message!;
}

/** New messages first (oldest first, so nothing waits forever), then handled ones. */
export async function listContactMessages(
  admin: Admin,
  status: ContactStatus,
): Promise<ContactMessage[]> {
  authorizePlatform(admin, "platform:messages:manage");
  return db
    .select()
    .from(contactMessages)
    .where(eq(contactMessages.status, status))
    .orderBy(status === "new" ? contactMessages.createdAt : desc(contactMessages.createdAt))
    .limit(200);
}

export async function countNewContactMessages(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contactMessages)
    .where(eq(contactMessages.status, "new"));
  return row!.count;
}

/** Close a message (handled) or put it back in the queue (new). */
export async function setContactMessageStatus(
  admin: Admin,
  messageId: string,
  status: ContactStatus,
): Promise<void> {
  authorizePlatform(admin, "platform:messages:manage");
  if (!z.uuid().safeParse(messageId).success) throw new AppError("NOT_FOUND", "Message not found.");
  const handled = status === "handled";
  const [updated] = await db
    .update(contactMessages)
    .set({
      status,
      handledAt: handled ? new Date() : null,
      handledByUserId: handled ? admin.id : null,
    })
    .where(eq(contactMessages.id, messageId))
    .returning({ id: contactMessages.id });
  if (!updated) throw new AppError("NOT_FOUND", "Message not found.");
}
