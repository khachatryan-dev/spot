import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  auditLogs,
  diningTables,
  qrTokens,
  restaurantLocations,
  restaurants,
  restaurantStaff,
  users,
} from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import {
  ensureLocationQr,
  ensureTableQr,
  generateQrToken,
  listLocationQr,
  resolveQrToken,
  revokeTableQr,
  rotateTableQr,
} from "./qr-service";
import { createRestaurant } from "./restaurant-service";
import { createTable, createTablesBulk } from "./table-service";

beforeEach(() => truncate(db, ["audit_logs", "restaurants", "users"]));

async function createUser(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  return user!;
}

/** An active restaurant with one location and table 12. */
async function setup(slug = "cafe") {
  const owner = await createUser(`${slug}@example.am`);
  const restaurant = await createRestaurant(owner, { name: `${slug} place` });
  await db.update(restaurants).set({ status: "active" }).where(eq(restaurants.id, restaurant.id));
  const [location] = await db
    .insert(restaurantLocations)
    .values({
      restaurantId: restaurant.id,
      name: "Cascade",
      slug: "cascade",
      addressLine: "1 St",
      city: "Yerevan",
    })
    .returning();
  const table = await createTable(owner, restaurant.id, { locationId: location!.id, number: "12" });
  return { owner, restaurantId: restaurant.id, locationId: location!.id, table };
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).name),
  );

describe("tokens", () => {
  it("are 22-character URL-safe random values, unrelated to the table", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateQrToken));
    expect(tokens.size).toBe(1000);
    for (const token of [...tokens].slice(0, 20)) expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("ensureTableQr creates once and then returns the same token", async () => {
    const { owner, restaurantId, table } = await setup();
    const first = await ensureTableQr(owner, restaurantId, table.id);
    const again = await ensureTableQr(owner, restaurantId, table.id);
    expect(again.token).toBe(first.token);
    expect(first.token).not.toContain(table.id);
    expect(first.token).not.toContain("12");
  });
});

describe("resolveQrToken", () => {
  it("resolves a live token to its restaurant, location and table", async () => {
    const { owner, restaurantId, locationId, table } = await setup();
    const { token } = await ensureTableQr(owner, restaurantId, table.id);

    expect(await resolveQrToken(token)).toEqual({
      qrTokenId: expect.any(String),
      restaurantId,
      restaurantName: "cafe place",
      restaurantSlug: "cafe-place",
      locationId,
      locationName: "Cascade",
      tableId: table.id,
      tableNumber: "12",
    });
    const [row] = await db.select().from(qrTokens);
    expect(row?.lastScannedAt).toBeInstanceOf(Date);
  });

  it("never resolves revoked tokens: rotation invalidates the old code", async () => {
    const { owner, restaurantId, table } = await setup();
    const old = await ensureTableQr(owner, restaurantId, table.id);
    const fresh = await rotateTableQr(owner, restaurantId, table.id);

    expect(fresh.token).not.toBe(old.token);
    expect(await resolveQrToken(old.token)).toBeNull();
    expect((await resolveQrToken(fresh.token))?.tableId).toBe(table.id);

    await revokeTableQr(owner, restaurantId, table.id);
    expect(await resolveQrToken(fresh.token)).toBeNull();
    // History is kept.
    expect(await db.select().from(qrTokens).where(eq(qrTokens.tableId, table.id))).toHaveLength(2);
  });

  it("returns null for expired tokens and for inactive tables, locations or restaurants", async () => {
    const { owner, restaurantId, locationId, table } = await setup();
    const { token, id } = await ensureTableQr(owner, restaurantId, table.id);
    const resolves = async () => (await resolveQrToken(token)) !== null;

    await db
      .update(qrTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(qrTokens.id, id));
    expect(await resolves()).toBe(false);
    await db.update(qrTokens).set({ expiresAt: null }).where(eq(qrTokens.id, id));
    expect(await resolves()).toBe(true);

    await db.update(diningTables).set({ isActive: false }).where(eq(diningTables.id, table.id));
    expect(await resolves()).toBe(false);
    await db.update(diningTables).set({ isActive: true }).where(eq(diningTables.id, table.id));

    await db
      .update(restaurantLocations)
      .set({ status: "inactive" })
      .where(eq(restaurantLocations.id, locationId));
    expect(await resolves()).toBe(false);
    await db
      .update(restaurantLocations)
      .set({ status: "active" })
      .where(eq(restaurantLocations.id, locationId));

    for (const status of ["suspended", "pending_review", "draft"] as const) {
      await db.update(restaurants).set({ status }).where(eq(restaurants.id, restaurantId));
      expect([status, await resolves()]).toEqual([status, false]);
    }
  });

  it("rejects malformed and unknown tokens without touching anything", async () => {
    for (const bad of ["", "1", "table-12", "' OR 1=1 --", "a".repeat(200), generateQrToken()]) {
      expect(await resolveQrToken(bad)).toBeNull();
    }
  });
});

describe("safety", () => {
  it("keeps exactly one active token when two rotations race", async () => {
    const { owner, restaurantId, table } = await setup();
    await ensureTableQr(owner, restaurantId, table.id);
    await Promise.all([
      rotateTableQr(owner, restaurantId, table.id),
      rotateTableQr(owner, restaurantId, table.id),
    ]);

    const active = await db
      .select()
      .from(qrTokens)
      .where(and(eq(qrTokens.tableId, table.id), isNull(qrTokens.revokedAt)));
    expect(active).toHaveLength(1);
  });

  it("isolates restaurants and allows only managers and owners", async () => {
    const mine = await setup("mine");
    const theirs = await setup("theirs");
    const waiter = await createUser("waiter@example.am");
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: mine.restaurantId, userId: waiter.id, role: "waiter" });

    expect(await codeOf(ensureTableQr(mine.owner, mine.restaurantId, theirs.table.id))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(rotateTableQr(mine.owner, mine.restaurantId, theirs.table.id))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(listLocationQr(mine.owner, mine.restaurantId, theirs.locationId))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(ensureTableQr(waiter, mine.restaurantId, mine.table.id))).toBe("FORBIDDEN");
  });

  it("creates codes for all active tables of a location and audits every change", async () => {
    const { owner, restaurantId, locationId, table } = await setup();
    await createTablesBulk(owner, restaurantId, { locationId, from: 1, to: 3 });
    await db.update(diningTables).set({ isActive: false }).where(eq(diningTables.number, "3"));

    expect(await ensureLocationQr(owner, restaurantId, locationId)).toBe(3); // 12, 1, 2
    const list = await listLocationQr(owner, restaurantId, locationId);
    expect(
      list
        .filter((t) => t.token)
        .map((t) => t.number)
        .sort(),
    ).toEqual(["1", "12", "2"]);

    await rotateTableQr(owner, restaurantId, table.id);
    await revokeTableQr(owner, restaurantId, table.id);
    const actions = (await db.select({ action: auditLogs.action }).from(auditLogs)).map(
      (a) => a.action,
    );
    expect(actions.filter((a) => a.startsWith("qr."))).toEqual([
      "qr.created",
      "qr.created",
      "qr.created",
      "qr.rotated",
      "qr.revoked",
    ]);
  });
});
