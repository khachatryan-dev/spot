import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { restaurantLocations, restaurantStaff, users } from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import { createRestaurant } from "./restaurant-service";
import {
  createTable,
  createTablesBulk,
  getTable,
  listTables,
  reorderTables,
  updateTable,
} from "./table-service";

beforeEach(() => truncate(db, ["restaurants", "users"]));

async function createUser(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  return user!;
}

async function setup(slug: string) {
  const owner = await createUser(`${slug}@example.am`);
  const restaurant = await createRestaurant(owner, { name: `${slug} cafe` });
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
  return { owner, restaurantId: restaurant.id, locationId: location!.id };
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).name),
  );

describe("tables", () => {
  it("creates single and numbered tables in order", async () => {
    const { owner, restaurantId, locationId } = await setup("a");
    await createTablesBulk(owner, restaurantId, {
      locationId,
      from: 1,
      to: 3,
      capacity: 2,
      zone: "Hall",
    });
    await createTable(owner, restaurantId, {
      locationId,
      number: "VIP",
      capacity: 10,
      type: "private",
    });

    const tables = await listTables(owner, restaurantId, locationId);
    expect(tables.map((t) => [t.number, t.capacity, t.zone])).toEqual([
      ["1", 2, "Hall"],
      ["2", 2, "Hall"],
      ["3", 2, "Hall"],
      ["VIP", 10, null],
    ]);
  });

  it("reports duplicate numbers clearly, and bulk creation is all-or-nothing", async () => {
    const { owner, restaurantId, locationId } = await setup("a");
    await createTable(owner, restaurantId, { locationId, number: "5" });

    expect(await codeOf(createTable(owner, restaurantId, { locationId, number: " 5 " }))).toBe(
      "CONFLICT",
    );
    expect(
      await codeOf(createTablesBulk(owner, restaurantId, { locationId, from: 3, to: 7 })),
    ).toBe("CONFLICT");
    expect(await listTables(owner, restaurantId, locationId)).toHaveLength(1);

    const [only] = await listTables(owner, restaurantId, locationId);
    const other = await createTable(owner, restaurantId, { locationId, number: "6" });
    expect(await codeOf(updateTable(owner, restaurantId, other.id, { number: "5" }))).toBe(
      "CONFLICT",
    );
    expect(only?.number).toBe("5");
  });

  it("limits bulk ranges", async () => {
    const { owner, restaurantId, locationId } = await setup("a");
    expect(
      await codeOf(createTablesBulk(owner, restaurantId, { locationId, from: 1, to: 101 })),
    ).toBe("ZodError");
    expect(
      await codeOf(createTablesBulk(owner, restaurantId, { locationId, from: 5, to: 2 })),
    ).toBe("ZodError");
  });

  it("updates status, capacity and activity", async () => {
    const { owner, restaurantId, locationId } = await setup("a");
    const table = await createTable(owner, restaurantId, { locationId, number: "1" });
    const updated = await updateTable(owner, restaurantId, table.id, {
      status: "out_of_service",
      capacity: 6,
      isActive: false,
    });
    expect(updated).toMatchObject({ status: "out_of_service", capacity: 6, isActive: false });
  });

  it("reorders only the exact set of the location's tables", async () => {
    const { owner, restaurantId, locationId } = await setup("a");
    const [one, two] = await createTablesBulk(owner, restaurantId, { locationId, from: 1, to: 2 });
    await reorderTables(owner, restaurantId, locationId, [two!.id, one!.id]);
    expect((await listTables(owner, restaurantId, locationId)).map((t) => t.number)).toEqual([
      "2",
      "1",
    ]);
    expect(await codeOf(reorderTables(owner, restaurantId, locationId, [one!.id]))).toBe(
      "CONFLICT",
    );
  });
});

describe("tenant isolation and roles", () => {
  it("rejects other restaurants' locations and tables", async () => {
    const mine = await setup("mine");
    const theirs = await setup("theirs");
    const theirTable = await createTable(theirs.owner, theirs.restaurantId, {
      locationId: theirs.locationId,
      number: "1",
    });

    const r = mine.restaurantId;
    expect(await codeOf(listTables(mine.owner, r, theirs.locationId))).toBe("NOT_FOUND");
    expect(
      await codeOf(createTable(mine.owner, r, { locationId: theirs.locationId, number: "9" })),
    ).toBe("NOT_FOUND");
    expect(
      await codeOf(
        createTablesBulk(mine.owner, r, { locationId: theirs.locationId, from: 1, to: 2 }),
      ),
    ).toBe("NOT_FOUND");
    expect(await codeOf(getTable(mine.owner, r, theirTable.id))).toBe("NOT_FOUND");
    expect(await codeOf(updateTable(mine.owner, r, theirTable.id, { status: "blocked" }))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(listTables(mine.owner, theirs.restaurantId, theirs.locationId))).toBe(
      "NOT_FOUND",
    );
  });

  it("lets waiters read tables, but only managers and owners change them; kitchen sees nothing", async () => {
    const { restaurantId, locationId, owner } = await setup("a");
    const table = await createTable(owner, restaurantId, { locationId, number: "1" });
    const staff = async (email: string, role: "waiter" | "manager" | "kitchen") => {
      const user = await createUser(email);
      await db.insert(restaurantStaff).values({ restaurantId, userId: user.id, role });
      return user;
    };
    const waiter = await staff("w@example.am", "waiter");
    const manager = await staff("m@example.am", "manager");
    const cook = await staff("k@example.am", "kitchen");

    await expect(listTables(waiter, restaurantId, locationId)).resolves.toHaveLength(1);
    expect(await codeOf(updateTable(waiter, restaurantId, table.id, { status: "blocked" }))).toBe(
      "FORBIDDEN",
    );
    await expect(
      updateTable(manager, restaurantId, table.id, { status: "blocked" }),
    ).resolves.toBeDefined();
    expect(await codeOf(listTables(cook, restaurantId, locationId))).toBe("FORBIDDEN");
  });
});
