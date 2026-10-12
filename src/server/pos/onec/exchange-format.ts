import { z } from "zod";

import type { CloseBillInput, ExternalOrder, ExternalOrderUpdate } from "../provider";

/*
 * Spot ↔ 1C exchange format, version 1 (docs/pos-1c.md). 1C configurations
 * differ (§29), so instead of guessing each one's API, Spot speaks one small
 * JSON format and the 1C side implements it once: as an HTTP service Spot
 * calls ("1c"), or by calling Spot's exchange API itself ("1c-exchange").
 * Both modes use the same documents. Amounts are integer minor units
 * (1 AMD = 100), times are ISO 8601 UTC.
 */

export const EXCHANGE_VERSION = 1;

export type ChangeDocument =
  | {
      changeId: string;
      type: "order.created";
      order: {
        id: string;
        number: number;
        table: { number: string; externalId: string | null };
        currency: string;
        totalMinor: number;
        note: string | null;
        submittedAt: string;
        lines: {
          externalItemId: string | null;
          name: string;
          quantity: number;
          unitPriceMinor: number;
          lineTotalMinor: number;
          options: string[];
          note: string | null;
        }[];
      };
    }
  | {
      changeId: string;
      type: "order.status";
      orderId: string;
      externalOrderId: string | null;
      status: string;
      reason: string | null;
    }
  | {
      changeId: string;
      type: "bill.closed";
      billId: string;
      orderIds: string[];
      externalOrderIds: string[];
      currency: string;
      totalMinor: number;
      serviceFeeMinor: number;
      paidMinor: number;
    };

export const orderCreatedDocument = (changeId: string, o: ExternalOrder): ChangeDocument => ({
  changeId,
  type: "order.created",
  order: {
    id: o.orderId,
    number: o.number,
    table: { number: o.tableNumber, externalId: o.externalTableId },
    currency: o.currency,
    totalMinor: o.totalMinor,
    note: o.note,
    submittedAt: o.submittedAt,
    lines: o.lines.map((l) => ({
      externalItemId: l.externalItemId,
      name: l.name,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      lineTotalMinor: l.lineTotalMinor,
      options: l.options,
      note: l.note,
    })),
  },
});

export const orderStatusDocument = (changeId: string, u: ExternalOrderUpdate): ChangeDocument => ({
  changeId,
  type: "order.status",
  orderId: u.orderId,
  externalOrderId: u.externalOrderId,
  status: u.status,
  reason: u.reason,
});

export const billClosedDocument = (changeId: string, b: CloseBillInput): ChangeDocument => ({
  changeId,
  type: "bill.closed",
  billId: b.billId,
  orderIds: b.orderIds,
  externalOrderIds: b.externalOrderIds,
  currency: b.currency,
  totalMinor: b.totalMinor,
  serviceFeeMinor: b.serviceFeeMinor,
  paidMinor: b.paidMinor,
});

/* What 1C sends us. Strings are trimmed and bounded; ids are 1C's own. */

const externalId = z.string().trim().min(1).max(100);
const label = z.string().trim().min(1).max(200);

export const catalogSchema = z.object({
  items: z
    .array(
      z.object({
        externalId,
        name: label,
        priceMinor: z.number().int().min(0).max(1_000_000_000),
        category: label.optional(),
      }),
    )
    .max(5000),
  tables: z
    .array(z.object({ externalId, number: z.string().trim().min(1).max(20) }))
    .max(1000)
    .default([]),
});
export type Catalog = z.output<typeof catalogSchema>;

export const stockSchema = z.object({
  stock: z
    .array(z.object({ externalId, available: z.number().int().min(0).max(1_000_000) }))
    .max(5000),
});

/** 1C's answer to one change: done (with its own id for new orders), or not. */
export const changeResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), externalId: externalId.optional() }),
  z.object({
    ok: z.literal(false),
    error: z.string().trim().min(1).max(500),
    /** true: a temporary problem, send it again later; false: it will never work. */
    retry: z.boolean().default(false),
  }),
]);
export type ChangeResult = z.output<typeof changeResultSchema>;

export const acknowledgementSchema = z.object({
  results: z
    .array(z.object({ changeId: z.uuid() }).and(changeResultSchema))
    .min(1)
    .max(200),
});
