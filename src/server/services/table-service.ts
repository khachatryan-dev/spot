import "server-only";

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { type DiningTable, diningTables, restaurantLocations } from "@/server/db/schema";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import type { RestaurantPermission } from "@/shared/auth/permissions";
import { AppError } from "@/shared/errors";
import {
  type BulkTablesInput,
  bulkTablesSchema,
  type TableInput,
  tableSchema,
  type TableUpdateInput,
  tableUpdateSchema,
} from "@/shared/schemas/tables";

/*
 * Tables (§12). Every function authorizes the actor for the restaurant and
 * every query is scoped by restaurant_id + id (plus composite FKs in the DB).
 */

type Actor = Pick<SessionUser, "id">;

const duplicateNumber = () =>
  new AppError("CONFLICT", "A table with this number already exists here.", {
    fieldErrors: { number: ["tableNumberTaken"] },
  });

async function authorize(actor: Actor, restaurantId: string, permission: RestaurantPermission) {
  const access = await authorizeRestaurant(actor.id, restaurantId, permission);
  if (permission === "table:manage" && access.restaurantStatus === "closed") {
    throw new AppError("CONFLICT", "A closed restaurant can't be edited.");
  }
}

async function assertOwnLocation(restaurantId: string, locationId: string) {
  if (!z.uuid().safeParse(locationId).success)
    throw new AppError("NOT_FOUND", "Location not found.");
  const [row] = await db
    .select({ id: restaurantLocations.id })
    .from(restaurantLocations)
    .where(
      and(
        eq(restaurantLocations.id, locationId),
        eq(restaurantLocations.restaurantId, restaurantId),
      ),
    );
  if (!row) throw new AppError("NOT_FOUND", "Location not found.");
}

async function findTable(restaurantId: string, tableId: string): Promise<DiningTable> {
  if (!z.uuid().safeParse(tableId).success) throw new AppError("NOT_FOUND", "Table not found.");
  const [row] = await db
    .select()
    .from(diningTables)
    .where(and(eq(diningTables.id, tableId), eq(diningTables.restaurantId, restaurantId)));
  if (!row) throw new AppError("NOT_FOUND", "Table not found.");
  return row;
}

/** Tables of one location, in display order. */
export async function listTables(
  actor: Actor,
  restaurantId: string,
  locationId: string,
): Promise<DiningTable[]> {
  await authorize(actor, restaurantId, "table:read");
  await assertOwnLocation(restaurantId, locationId);
  return db
    .select()
    .from(diningTables)
    .where(
      and(eq(diningTables.restaurantId, restaurantId), eq(diningTables.locationId, locationId)),
    )
    .orderBy(asc(diningTables.sortOrder), asc(diningTables.createdAt));
}

export async function getTable(actor: Actor, restaurantId: string, tableId: string) {
  await authorize(actor, restaurantId, "table:read");
  return findTable(restaurantId, tableId);
}

async function nextSortOrder(locationId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(diningTables)
    .where(eq(diningTables.locationId, locationId));
  return row?.value ?? 0;
}

export async function createTable(
  actor: Actor,
  restaurantId: string,
  input: TableInput,
): Promise<DiningTable> {
  await authorize(actor, restaurantId, "table:manage");
  const data = tableSchema.parse(input);
  await assertOwnLocation(restaurantId, data.locationId);
  try {
    const [table] = await db
      .insert(diningTables)
      .values({ ...data, restaurantId, sortOrder: await nextSortOrder(data.locationId) })
      .returning();
    return table!;
  } catch (error) {
    if (isUniqueViolation(error, "tables_location_number_unique")) throw duplicateNumber();
    throw error;
  }
}

/** Create tables numbered `from`…`to`. All or nothing: any existing number aborts. */
export async function createTablesBulk(actor: Actor, restaurantId: string, input: BulkTablesInput) {
  await authorize(actor, restaurantId, "table:manage");
  const { locationId, from, to, capacity, zone } = bulkTablesSchema.parse(input);
  await assertOwnLocation(restaurantId, locationId);

  const numbers = Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
  const existing = await db
    .select({ number: diningTables.number })
    .from(diningTables)
    .where(
      and(
        eq(diningTables.locationId, locationId),
        inArray(sql`lower(trim(${diningTables.number}))`, numbers),
      ),
    );
  if (existing.length > 0) {
    throw new AppError(
      "CONFLICT",
      `Tables already exist: ${existing.map((e) => e.number).join(", ")}.`,
      {
        fieldErrors: { from: ["tableRangeTaken"] },
      },
    );
  }

  const start = await nextSortOrder(locationId);
  try {
    return await db
      .insert(diningTables)
      .values(
        numbers.map((n, i) => ({
          restaurantId,
          locationId,
          number: n,
          capacity,
          zone,
          sortOrder: start + i,
        })),
      )
      .returning();
  } catch (error) {
    if (isUniqueViolation(error, "tables_location_number_unique")) throw duplicateNumber();
    throw error;
  }
}

export async function updateTable(
  actor: Actor,
  restaurantId: string,
  tableId: string,
  input: TableUpdateInput,
) {
  await authorize(actor, restaurantId, "table:manage");
  const current = await findTable(restaurantId, tableId);
  const data = tableUpdateSchema.parse(input);
  if (Object.keys(data).length === 0) return current;
  try {
    const [updated] = await db
      .update(diningTables)
      .set(data)
      .where(and(eq(diningTables.id, tableId), eq(diningTables.restaurantId, restaurantId)))
      .returning();
    return updated!;
  } catch (error) {
    if (isUniqueViolation(error, "tables_location_number_unique")) throw duplicateNumber();
    throw error;
  }
}

/** Reorder tables of one location; `orderedIds` must be exactly its tables. */
export async function reorderTables(
  actor: Actor,
  restaurantId: string,
  locationId: string,
  orderedIds: string[],
) {
  await authorize(actor, restaurantId, "table:manage");
  await assertOwnLocation(restaurantId, locationId);
  const ids = z.array(z.uuid()).max(1000).parse(orderedIds);
  await db.transaction(async (tx) => {
    const current = await tx
      .select({ id: diningTables.id })
      .from(diningTables)
      .where(
        and(eq(diningTables.locationId, locationId), eq(diningTables.restaurantId, restaurantId)),
      );
    const set = new Set(current.map((c) => c.id));
    if (ids.length !== set.size || !ids.every((id) => set.has(id))) {
      throw new AppError("CONFLICT", "The list changed. Please reload and try again.");
    }
    for (const [index, id] of ids.entries()) {
      await tx
        .update(diningTables)
        .set({ sortOrder: index })
        .where(and(eq(diningTables.id, id), eq(diningTables.restaurantId, restaurantId)));
    }
  });
}
