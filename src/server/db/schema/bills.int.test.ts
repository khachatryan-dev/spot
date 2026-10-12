import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { truncate } from "@/test/db";

import { billItems, bills } from "./bills";
import { restaurantLocations, restaurants } from "./restaurants";
import { tableSessions } from "./table-sessions";
import { diningTables } from "./tables";

beforeEach(() => truncate(db, ["restaurants"]));

let codes = 0;
async function visit(slug = `cafe-${codes + 1}`) {
  const [restaurant] = await db.insert(restaurants).values({ name: slug, slug }).returning();
  const [location] = await db
    .insert(restaurantLocations)
    .values({
      restaurantId: restaurant!.id,
      name: "Main",
      slug: "main",
      addressLine: "1 St",
      city: "Yerevan",
    })
    .returning();
  const [table] = await db
    .insert(diningTables)
    .values({ restaurantId: restaurant!.id, locationId: location!.id, number: "1" })
    .returning();
  const [session] = await db
    .insert(tableSessions)
    .values({
      restaurantId: restaurant!.id,
      tableId: table!.id,
      code: `CODE${String(++codes).padStart(2, "0")}`,
    })
    .returning();
  return {
    restaurantId: restaurant!.id,
    locationId: location!.id,
    tableId: table!.id,
    tableSessionId: session!.id,
  };
}

async function openBill(at: Awaited<ReturnType<typeof visit>>) {
  const [bill] = await db
    .insert(bills)
    .values({ ...at, currency: "AMD" })
    .returning();
  return bill!;
}

/** The database's own message (Drizzle wraps driver errors in `cause`). */
const dbError = (p: Promise<unknown>) =>
  p.then(
    () => "no error",
    (e: { cause?: { message?: string } }) => e.cause?.message ?? String(e),
  );

const line = (bill: { id: string; restaurantId: string }, unit = 350_000, quantity = 2) => ({
  restaurantId: bill.restaurantId,
  billId: bill.id,
  name: "Khorovats",
  unitPriceMinor: unit,
  modifiersTotalMinor: 50_000,
  quantity,
  lineTotalMinor: (unit + 50_000) * quantity,
});

/** Lines 800 000 + 10 % service = 880 000. */
async function finalized() {
  const at = await visit();
  const bill = await openBill(at);
  await db.insert(billItems).values(line(bill));
  await db
    .update(bills)
    .set({
      subtotalMinor: 800_000,
      serviceFeeBps: 1000,
      serviceFeeMinor: 80_000,
      totalMinor: 880_000,
      status: "finalized",
      finalizedAt: new Date(),
    })
    .where(eq(bills.id, bill.id));
  return { ...at, bill };
}

describe("bills", () => {
  it("opens empty, in the restaurant's currency", async () => {
    expect(await openBill(await visit())).toMatchObject({
      status: "open",
      subtotalMinor: 0,
      totalMinor: 0,
      paidMinor: 0,
    });
  });

  it("keeps one live bill per visit; a voided one can be replaced", async () => {
    const at = await visit();
    const first = await openBill(at);
    await expect(openBill(at)).rejects.toThrow();
    await db
      .update(bills)
      .set({ status: "void", voidedAt: new Date(), voidReason: "Opened by mistake" })
      .where(eq(bills.id, first.id));
    await openBill(at);
  });

  it("checks the arithmetic: line totals and bill totals", async () => {
    const bill = await openBill(await visit());
    await expect(
      db.insert(billItems).values({ ...line(bill), lineTotalMinor: 1 }),
    ).rejects.toThrow();
    await expect(
      db.update(bills).set({ subtotalMinor: 100, totalMinor: 99 }).where(eq(bills.id, bill.id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(bills)
        .set({ subtotalMinor: 100, discountMinor: 200, totalMinor: -100 })
        .where(eq(bills.id, bill.id)),
    ).rejects.toThrow();
    await expect(
      db.update(bills).set({ serviceFeeBps: 5000 }).where(eq(bills.id, bill.id)),
    ).rejects.toThrow();
  });

  it("can't be finalized unless the lines add up to the subtotal", async () => {
    const bill = await openBill(await visit());
    await db.insert(billItems).values(line(bill));
    expect(
      await dbError(
        db
          .update(bills)
          .set({ subtotalMinor: 700_000, totalMinor: 700_000, status: "finalized" })
          .where(eq(bills.id, bill.id)),
      ),
    ).toMatch(/add up to 800000, not the subtotal 700000/);
  });

  it("locks a finalized bill's amounts and lines, and never reopens it", async () => {
    const { bill } = await finalized();
    for (const change of [
      { totalMinor: 1, subtotalMinor: 1, serviceFeeMinor: 0 },
      { discountMinor: 80_000, totalMinor: 800_000 },
      { status: "open" as const },
    ]) {
      await expect(db.update(bills).set(change).where(eq(bills.id, bill.id))).rejects.toThrow();
    }
    expect(await dbError(db.insert(billItems).values(line(bill, 100, 1)))).toMatch(
      /Lines of a finalized bill can't change/,
    );
    await expect(
      db.update(billItems).set({ name: "Free" }).where(eq(billItems.billId, bill.id)),
    ).rejects.toThrow();
    await expect(db.delete(billItems).where(eq(billItems.billId, bill.id))).rejects.toThrow();
  });

  it("is paid only once finalized and fully paid; then final", async () => {
    const at = await visit();
    const open = await openBill(at);
    await expect(
      db.update(bills).set({ status: "paid", paidAt: new Date() }).where(eq(bills.id, open.id)),
    ).rejects.toThrow();

    const { bill } = await finalized();
    await expect(
      db
        .update(bills)
        .set({ status: "paid", paidMinor: 500_000, paidAt: new Date() })
        .where(eq(bills.id, bill.id)),
    ).rejects.toThrow();
    await expect(
      db.update(bills).set({ paidMinor: 900_000 }).where(eq(bills.id, bill.id)),
    ).rejects.toThrow();
    await db
      .update(bills)
      .set({ status: "paid", paidMinor: 880_000, paidAt: new Date() })
      .where(eq(bills.id, bill.id));
    await expect(
      db
        .update(bills)
        .set({ status: "void", voidReason: "x", voidedAt: new Date() })
        .where(eq(bills.id, bill.id)),
    ).rejects.toThrow();
  });

  it("can't void a bill with money on it, nor delete any bill", async () => {
    const { bill } = await finalized();
    await db.update(bills).set({ paidMinor: 100_000 }).where(eq(bills.id, bill.id));
    await expect(
      db
        .update(bills)
        .set({ status: "void", voidReason: "Wrong table", voidedAt: new Date() })
        .where(eq(bills.id, bill.id)),
    ).rejects.toThrow();
    await expect(db.delete(bills).where(eq(bills.id, bill.id))).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM bills`)).rejects.toThrow();
  });

  it("keeps lines with their own restaurant's bill", async () => {
    const mine = await openBill(await visit("mine"));
    const theirs = await visit("theirs");
    await expect(
      db.insert(billItems).values({ ...line(mine), restaurantId: theirs.restaurantId }),
    ).rejects.toThrow();
  });
});
