import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";

import { createToken, hashToken } from "@/server/crypto/tokens";
import { db } from "@/server/db/client";
import { guests, type Guest } from "@/server/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Guests expire after 30 days without activity. */
export const GUEST_TTL_MS = 30 * DAY_MS;
/** Extend the expiry at most once a day to avoid a write on every request. */
const TOUCH_INTERVAL_MS = DAY_MS;

/** Create a guest. The raw token goes in the cookie and is never stored. */
export async function createGuest(now = new Date()): Promise<{ guest: Guest; token: string }> {
  const token = createToken();
  const [guest] = await db
    .insert(guests)
    .values({
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + GUEST_TTL_MS),
      lastSeenAt: now,
    })
    .returning();
  if (!guest) throw new Error("Failed to create guest");
  return { guest, token };
}

/**
 * Resolve a cookie token to an active guest, or null if unknown, expired or
 * claimed. A claimed guest's history belongs to the user now, so its cookie
 * must not keep working after that user signs out on a shared device.
 * Slides the expiry forward (at most once a day) while the guest is active.
 */
export async function findGuestByToken(
  token: string | undefined,
  now = new Date(),
): Promise<Guest | null> {
  if (!token) return null;
  const [guest] = await db
    .select()
    .from(guests)
    .where(
      and(
        eq(guests.tokenHash, hashToken(token)),
        gt(guests.expiresAt, now),
        isNull(guests.claimedByUserId),
      ),
    );
  if (!guest) return null;

  if (now.getTime() - guest.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return guest;

  const [touched] = await db
    .update(guests)
    .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + GUEST_TTL_MS) })
    .where(eq(guests.id, guest.id))
    .returning();
  return touched ?? guest;
}

/**
 * Link a guest to the account that just signed in. A guest can be claimed
 * only once; later claims (e.g. a shared device) are ignored.
 */
export async function claimGuest(guestId: string, userId: string, now = new Date()) {
  const [claimed] = await db
    .update(guests)
    .set({ claimedByUserId: userId, claimedAt: now })
    .where(and(eq(guests.id, guestId), isNull(guests.claimedByUserId)))
    .returning();
  return claimed ?? null;
}
