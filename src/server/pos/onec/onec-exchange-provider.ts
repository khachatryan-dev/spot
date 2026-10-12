import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { posCatalogSnapshots } from "@/server/db/schema";
import { AppError } from "@/shared/errors";

import type { PosProvider } from "../provider";

/*
 * 1C that calls Spot (the usual setup when 1C runs on an office computer
 * behind a router): it collects changes from Spot's exchange API, confirms
 * each one, and uploads its menu, tables and stock (pos-exchange-service).
 * Nothing is sent from here, so the delivery methods are never called.
 */

async function snapshot(connectionId: string) {
  const [row] = await db
    .select()
    .from(posCatalogSnapshots)
    .where(eq(posCatalogSnapshots.connectionId, connectionId));
  return row ?? null;
}

const pullOnly = () => {
  throw new Error("1C collects its changes from Spot; nothing is sent to it.");
};

export const oneCExchangeProvider: PosProvider = {
  name: "1c-exchange",
  pulls: true,

  async getMenu(context) {
    const row = await snapshot(context.connectionId);
    if (!row?.menu) throw new AppError("CONFLICT", "1C hasn't sent its menu yet.");
    return { items: row.menu };
  },
  async getTables(context) {
    return (await snapshot(context.connectionId))?.tables ?? [];
  },
  async getStock(context) {
    return (await snapshot(context.connectionId))?.stock ?? [];
  },

  createOrder: pullOnly,
  updateOrder: pullOnly,
  closeBill: pullOnly,
};
