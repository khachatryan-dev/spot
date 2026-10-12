import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { truncate } from "@/test/db";

import { restaurantLocations, restaurants } from "./restaurants";
import { diningTables, qrTokens } from "./tables";

beforeEach(() => truncate(db, ["restaurants"]));

const token = () => randomBytes(16).toString("base64url");

async function location(slug: string) {
  const [restaurant] = await db.insert(restaurants).values({ name: slug, slug }).returning();
  const [loc] = await db
    .insert(restaurantLocations)
    .values({
      restaurantId: restaurant!.id,
      name: "Main",
      slug: "main",
      addressLine: "1 St",
      city: "Yerevan",
    })
    .returning();
  return { restaurantId: restaurant!.id, locationId: loc!.id };
}

async function table(at: { restaurantId: string; locationId: string }, number = "12") {
  const [row] = await db
    .insert(diningTables)
    .values({ ...at, number })
    .returning();
  return row!;
}

describe("tables", () => {
  it("defaults to an available standard table for 4", async () => {
    expect(await table(await location("a"))).toMatchObject({
      capacity: 4,
      type: "standard",
      status: "available",
      isActive: true,
    });
  });

  it("keeps table numbers unique per location, ignoring case and spaces", async () => {
    const a = await location("a");
    const b = await location("b");
    await table(a, "A3");
    await table(b, "A3"); // another restaurant may reuse it
    await expect(table(a, "a3 ")).rejects.toThrow();
  });

  it("rejects blank numbers and impossible capacities", async () => {
    const at = await location("a");
    await expect(table(at, "   ")).rejects.toThrow();
    for (const capacity of [0, 51]) {
      await expect(
        db.insert(diningTables).values({ ...at, number: `T${capacity}`, capacity }),
      ).rejects.toThrow();
    }
  });

  it("won't place a table at another restaurant's location", async () => {
    const a = await location("a");
    const b = await location("b");
    await expect(
      db
        .insert(diningTables)
        .values({ restaurantId: a.restaurantId, locationId: b.locationId, number: "1" }),
    ).rejects.toThrow();
  });

  it("can't remove a location that still has tables", async () => {
    const at = await location("a");
    await table(at);
    await expect(
      db.delete(restaurantLocations).where(eq(restaurantLocations.id, at.locationId)),
    ).rejects.toThrow();
  });
});

describe("qr tokens", () => {
  it("allows one active token per table, keeping revoked ones as history", async () => {
    const at = await location("a");
    const t = await table(at);
    const [first] = await db
      .insert(qrTokens)
      .values({ restaurantId: at.restaurantId, tableId: t.id, token: token() })
      .returning();

    await expect(
      db.insert(qrTokens).values({ restaurantId: at.restaurantId, tableId: t.id, token: token() }),
    ).rejects.toThrow();

    await db.update(qrTokens).set({ revokedAt: new Date() }).where(eq(qrTokens.id, first!.id));
    await db
      .insert(qrTokens)
      .values({ restaurantId: at.restaurantId, tableId: t.id, token: token() });
    expect(await db.select().from(qrTokens).where(eq(qrTokens.tableId, t.id))).toHaveLength(2);
  });

  it("rejects guessable or malformed tokens and duplicates", async () => {
    const at = await location("a");
    const t1 = await table(at, "1");
    const t2 = await table(at, "2");
    for (const bad of ["1", "table-12", "short", "has spaces in it 1234567890", "x".repeat(65)]) {
      await expect(
        db.insert(qrTokens).values({ restaurantId: at.restaurantId, tableId: t1.id, token: bad }),
      ).rejects.toThrow();
    }
    const shared = token();
    await db
      .insert(qrTokens)
      .values({ restaurantId: at.restaurantId, tableId: t1.id, token: shared });
    await expect(
      db.insert(qrTokens).values({ restaurantId: at.restaurantId, tableId: t2.id, token: shared }),
    ).rejects.toThrow();
  });

  it("won't attach a token to another restaurant's table", async () => {
    const a = await location("a");
    const b = await location("b");
    const theirs = await table(b);
    await expect(
      db
        .insert(qrTokens)
        .values({ restaurantId: a.restaurantId, tableId: theirs.id, token: token() }),
    ).rejects.toThrow();
  });
});
