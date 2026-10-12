import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  auditLogs,
  restaurantLocations,
  restaurants,
  restaurantStaff,
  tableSessionMembers,
  tableSessions,
  users,
} from "@/server/db/schema";
import { createGuest } from "@/server/guests/guest-service";
import type { Customer } from "@/server/guests/current-customer";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import { ensureTableQr, resolveQrToken, rotateTableQr } from "./qr-service";
import { createRestaurant } from "./restaurant-service";
import { createTable } from "./table-service";
import {
  closeIdleTableSessions,
  closeTableSession,
  getCustomerTableSession,
  joinTableSession,
  leaveTableSession,
  listActiveSessions,
} from "./table-session-service";

beforeEach(() => truncate(db, ["audit_logs", "restaurants", "users", "guests"]));

const HOUR = 60 * 60 * 1000;

async function guest(): Promise<Customer> {
  return { type: "guest", guest: (await createGuest()).guest };
}

/** Active restaurant with table 7 and its QR code; returns the resolved QR. */
async function scanSetup() {
  const [owner] = await db.insert(users).values({ email: "owner@example.am" }).returning();
  const restaurant = await createRestaurant(owner!, { name: "Cafe Seven" });
  await db.update(restaurants).set({ status: "active" }).where(eq(restaurants.id, restaurant.id));
  const [location] = await db
    .insert(restaurantLocations)
    .values({
      restaurantId: restaurant.id,
      name: "Main",
      slug: "main",
      addressLine: "1 St",
      city: "Yerevan",
    })
    .returning();
  const table = await createTable(owner!, restaurant.id, { locationId: location!.id, number: "7" });
  const { token } = await ensureTableQr(owner!, restaurant.id, table.id);
  return {
    owner: owner!,
    restaurantId: restaurant.id,
    locationId: location!.id,
    table,
    token,
    qr: (await resolveQrToken(token))!,
  };
}

describe("joinTableSession", () => {
  it("starts a session on first scan and lets others at the table join it", async () => {
    const { qr } = await scanSetup();
    const ani = await guest();
    const bob = await guest();

    const first = await joinTableSession(ani, qr);
    const second = await joinTableSession(bob, qr);
    expect(second.id).toBe(first.id);
    expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(await db.select().from(tableSessionMembers)).toHaveLength(2);
  });

  it("doesn't duplicate a member who scans again", async () => {
    const { qr } = await scanSetup();
    const ani = await guest();
    await joinTableSession(ani, qr);
    await joinTableSession(ani, qr);
    expect(await db.select().from(tableSessionMembers)).toHaveLength(1);
  });

  it("supports signed-in users as members", async () => {
    const { qr, owner } = await scanSetup();
    const session = await joinTableSession({ type: "user", user: owner as never }, qr);
    const [member] = await db.select().from(tableSessionMembers);
    expect(member).toMatchObject({ sessionId: session.id, userId: owner.id, guestId: null });
  });

  it("starts a fresh session after the old one went idle", async () => {
    const { qr } = await scanSetup();
    const now = new Date();
    const old = await joinTableSession(await guest(), qr, new Date(now.getTime() - 9 * HOUR));
    const fresh = await joinTableSession(await guest(), qr, now);

    expect(fresh.id).not.toBe(old.id);
    const [closed] = await db.select().from(tableSessions).where(eq(tableSessions.id, old.id));
    expect(closed).toMatchObject({ status: "closed", closedReason: "expired" });
  });

  it("gives simultaneous first scans one shared session", async () => {
    const { qr } = await scanSetup();
    const sessions = await Promise.all(
      Array.from({ length: 5 }, async () => joinTableSession(await guest(), qr)),
    );
    expect(new Set(sessions.map((s) => s.id)).size).toBe(1);
    expect(await db.select().from(tableSessions)).toHaveLength(1);
  });
});

describe("getCustomerTableSession", () => {
  it("returns the session with restaurant and table for its members only", async () => {
    const { qr } = await scanSetup();
    const ani = await guest();
    const stranger = await guest();
    const session = await joinTableSession(ani, qr);

    expect(await getCustomerTableSession(ani, session.id)).toMatchObject({
      sessionId: session.id,
      restaurant: { name: "Cafe Seven" },
      table: { number: "7" },
    });
    // Knowing the session id is not enough.
    expect(await getCustomerTableSession(stranger, session.id)).toBeNull();
    expect(await getCustomerTableSession(ani, undefined)).toBeNull();
    expect(await getCustomerTableSession(ani, "not-a-uuid")).toBeNull();
  });

  it("returns null once the session is closed, idle or the restaurant is suspended", async () => {
    const { qr, restaurantId } = await scanSetup();
    const ani = await guest();
    const now = new Date();
    const session = await joinTableSession(ani, qr, now);

    expect(
      await getCustomerTableSession(ani, session.id, new Date(now.getTime() + 9 * HOUR)),
    ).toBeNull();

    await db
      .update(restaurants)
      .set({ status: "suspended" })
      .where(eq(restaurants.id, restaurantId));
    expect(await getCustomerTableSession(ani, session.id, now)).toBeNull();
    await db.update(restaurants).set({ status: "active" }).where(eq(restaurants.id, restaurantId));

    expect(await closeIdleTableSessions(new Date(now.getTime() + 9 * HOUR))).toBe(1);
    expect(await getCustomerTableSession(ani, session.id, now)).toBeNull();
  });
});

describe("revoked QR codes", () => {
  it("can't start or join a session", async () => {
    const { owner, restaurantId, table, token } = await scanSetup();
    await rotateTableQr(owner, restaurantId, table.id);
    expect(await resolveQrToken(token)).toBeNull(); // the scan route stops here
  });
});

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).name),
  );

describe("leaving", () => {
  it("removes only that customer's access; scanning again rejoins", async () => {
    const { qr } = await scanSetup();
    const ani = await guest();
    const bob = await guest();
    const session = await joinTableSession(ani, qr);
    await joinTableSession(bob, qr);

    await leaveTableSession(ani, session.id);
    expect(await getCustomerTableSession(ani, session.id)).toBeNull();
    expect(await getCustomerTableSession(bob, session.id)).not.toBeNull();

    await joinTableSession(ani, qr);
    expect(await getCustomerTableSession(ani, session.id)).not.toBeNull();
  });
});

describe("staff session management", () => {
  it("lists active visits with member counts and closes them", async () => {
    const { owner, restaurantId, locationId, table, qr } = await scanSetup();
    const ani = await guest();
    const session = await joinTableSession(ani, qr);
    await joinTableSession(await guest(), qr);

    const [active] = await listActiveSessions(owner, restaurantId, locationId);
    expect(active).toMatchObject({
      sessionId: session.id,
      tableId: table.id,
      code: session.code,
      memberCount: 2,
    });

    await closeTableSession(owner, restaurantId, session.id);
    expect(await listActiveSessions(owner, restaurantId, locationId)).toEqual([]);
    expect(await getCustomerTableSession(ani, session.id)).toBeNull();
    const [closed] = await db.select().from(tableSessions).where(eq(tableSessions.id, session.id));
    expect(closed).toMatchObject({
      status: "closed",
      closedReason: "staff",
      closedByUserId: owner.id,
    });
    const [entry] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "table_session.closed"));
    expect(entry?.metadata).toMatchObject({ code: session.code });

    // The next scan starts a new visit.
    expect((await joinTableSession(ani, qr)).id).not.toBe(session.id);
    expect(await codeOf(closeTableSession(owner, restaurantId, session.id))).toBe("NOT_FOUND");
  });

  it("lets waiters and cashiers close visits, not the kitchen or other restaurants", async () => {
    const { restaurantId, qr } = await scanSetup();
    const staff = async (email: string, role: "waiter" | "cashier" | "kitchen") => {
      const [user] = await db.insert(users).values({ email }).returning();
      await db.insert(restaurantStaff).values({ restaurantId, userId: user!.id, role });
      return user!;
    };
    const cook = await staff("cook@example.am", "kitchen");
    const waiter = await staff("waiter@example.am", "waiter");
    const [outsider] = await db.insert(users).values({ email: "out@example.am" }).returning();

    const session = await joinTableSession(await guest(), qr);
    expect(await codeOf(closeTableSession(cook, restaurantId, session.id))).toBe("FORBIDDEN");
    expect(await codeOf(closeTableSession(outsider!, restaurantId, session.id))).toBe("NOT_FOUND");
    await expect(closeTableSession(waiter, restaurantId, session.id)).resolves.toBeUndefined();

    const next = await joinTableSession(await guest(), qr);
    const cashier = await staff("cash@example.am", "cashier");
    await expect(closeTableSession(cashier, restaurantId, next.id)).resolves.toBeUndefined();
  });

  it("won't close another restaurant's visit through your own restaurant id", async () => {
    const theirs = await scanSetup();
    const [me] = await db.insert(users).values({ email: "me@example.am" }).returning();
    const mine = await createRestaurant(me!, { name: "My place" });
    const session = await joinTableSession(await guest(), theirs.qr);

    expect(await codeOf(closeTableSession(me!, mine.id, session.id))).toBe("NOT_FOUND");
    // Own restaurant id + another restaurant's location: nothing is listed.
    expect(await listActiveSessions(me!, mine.id, theirs.locationId)).toEqual([]);
  });
});
