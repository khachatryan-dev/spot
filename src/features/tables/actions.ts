"use server";

import { requireUser } from "@/server/auth/guards";
import { action } from "@/server/http/response";
import {
  createTable,
  createTablesBulk,
  reorderTables,
  updateTable,
} from "@/server/services/table-service";
import type { BulkTablesInput, TableInput, TableUpdateInput } from "@/shared/schemas/tables";

export async function createTableAction(restaurantId: string, input: TableInput) {
  return action(async () => {
    await createTable(await requireUser(), restaurantId, input);
    return { ok: true };
  });
}

export async function createTablesBulkAction(restaurantId: string, input: BulkTablesInput) {
  return action(async () => {
    const tables = await createTablesBulk(await requireUser(), restaurantId, input);
    return { count: tables.length };
  });
}

export async function updateTableAction(
  restaurantId: string,
  tableId: string,
  input: TableUpdateInput,
) {
  return action(async () => {
    await updateTable(await requireUser(), restaurantId, tableId, input);
    return { ok: true };
  });
}

export async function reorderTablesAction(
  restaurantId: string,
  locationId: string,
  orderedIds: string[],
) {
  return action(async () => {
    await reorderTables(await requireUser(), restaurantId, locationId, orderedIds);
    return { ok: true };
  });
}
