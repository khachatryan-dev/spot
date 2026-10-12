import { randomUUID } from "node:crypto";

import type {
  CloseBillInput,
  ExternalOrder,
  ExternalOrderUpdate,
  PosMenuItem,
  PosProvider,
  PosStockLevel,
  PosTable,
} from "./provider";
import { PosPermanentError } from "./provider";

/*
 * In-memory POS for tests and local development. It behaves like a real
 * one where it matters: repeated deliveries with the same key are ignored,
 * and tests can make it fail or go offline.
 */

export interface FakePos extends PosProvider {
  menu: PosMenuItem[];
  tables: PosTable[];
  stock: PosStockLevel[];
  /** Orders as the POS sees them, by POS order id. */
  readonly orders: Map<string, ExternalOrder & { status: string; closed: boolean }>;
  readonly closedBills: CloseBillInput[];
  /** The next `count` calls fail like a network error (retried) or a rejection (not retried). */
  failNext(count?: number, kind?: "offline" | "reject"): void;
  readonly calls: { createOrder: number; updateOrder: number; closeBill: number };
  reset(): void;
}

export function createFakePos(): FakePos {
  const orders = new Map<string, ExternalOrder & { status: string; closed: boolean }>();
  const byKey = new Map<string, string>();
  const seenKeys = new Set<string>();
  const closedBills: CloseBillInput[] = [];
  const calls = { createOrder: 0, updateOrder: 0, closeBill: 0 };
  let failures: { left: number; kind: "offline" | "reject" } = { left: 0, kind: "offline" };

  const maybeFail = () => {
    if (failures.left <= 0) return;
    failures.left--;
    if (failures.kind === "reject") throw new PosPermanentError("Rejected by the POS");
    throw new Error("POS is offline");
  };

  const pos: FakePos = {
    name: "fake",
    menu: [],
    tables: [],
    stock: [],
    orders,
    closedBills,
    calls,
    failNext(count = 1, kind = "offline") {
      failures = { left: count, kind };
    },
    reset() {
      orders.clear();
      byKey.clear();
      seenKeys.clear();
      closedBills.length = 0;
      Object.assign(calls, { createOrder: 0, updateOrder: 0, closeBill: 0 });
      failures = { left: 0, kind: "offline" };
      pos.menu = [];
      pos.tables = [];
      pos.stock = [];
    },

    async getMenu() {
      maybeFail();
      return { items: pos.menu };
    },
    async getTables() {
      maybeFail();
      return pos.tables;
    },
    async getStock() {
      maybeFail();
      return pos.stock;
    },

    async createOrder(_context, input: ExternalOrder) {
      calls.createOrder++;
      maybeFail();
      const existing = byKey.get(input.idempotencyKey);
      if (existing) return { externalOrderId: existing };
      const id = `pos_${randomUUID()}`;
      byKey.set(input.idempotencyKey, id);
      orders.set(id, { ...input, status: "new", closed: false });
      return { externalOrderId: id };
    },

    async updateOrder(_context, input: ExternalOrderUpdate) {
      calls.updateOrder++;
      maybeFail();
      if (seenKeys.has(input.idempotencyKey)) return;
      const order = input.externalOrderId ? orders.get(input.externalOrderId) : undefined;
      if (!order) throw new PosPermanentError(`Unknown POS order ${input.externalOrderId}`);
      seenKeys.add(input.idempotencyKey);
      order.status = input.status;
    },

    async closeBill(_context, input: CloseBillInput) {
      calls.closeBill++;
      maybeFail();
      if (seenKeys.has(input.idempotencyKey)) return;
      seenKeys.add(input.idempotencyKey);
      for (const id of input.externalOrderIds) {
        const order = orders.get(id);
        if (order) order.closed = true;
      }
      closedBills.push(input);
    },
  };
  return pos;
}
