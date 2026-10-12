/*
 * POS integration point (§29). Spot runs a restaurant completely on its own;
 * a POS (iiko, r_keeper, Poster, 1C…) is an optional extra, connected per
 * location. Business code never calls a POS directly: changes go through
 * the POS outbox (pos-service), which calls this interface in the
 * background, in order, with retries. Amounts are integer minor units.
 */

export type PosSettings = Record<string, string | number | boolean>;

/** Which connection a call is for, with its settings and (decrypted) password. */
export interface PosContext {
  connectionId: string;
  settings: PosSettings;
  secret: string | null;
}

export interface PosMenuItem {
  externalId: string;
  name: string;
  priceMinor: number;
  category?: string;
}

export interface PosMenu {
  items: PosMenuItem[];
}

export interface PosTable {
  externalId: string;
  /** What's written on the table, matched to our table numbers. */
  number: string;
}

export interface PosStockLevel {
  externalId: string;
  /** Portions left; 0 means sold out. */
  available: number;
}

export interface ExternalOrderLine {
  /** The POS's id for the dish, when the item is linked. */
  externalItemId: string | null;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  options: string[];
  note: string | null;
}

export interface ExternalOrder {
  /** Same key → same POS order, so a retried delivery never duplicates. */
  idempotencyKey: string;
  orderId: string;
  number: number;
  tableNumber: string;
  externalTableId: string | null;
  currency: string;
  totalMinor: number;
  note: string | null;
  lines: ExternalOrderLine[];
  submittedAt: string;
}

export interface ExternalOrderUpdate {
  idempotencyKey: string;
  orderId: string;
  /** Null when the POS hasn't told us its id (POSes that keep our ids). */
  externalOrderId: string | null;
  status: string;
  reason: string | null;
}

export interface CloseBillInput {
  idempotencyKey: string;
  billId: string;
  orderIds: string[];
  externalOrderIds: string[];
  currency: string;
  totalMinor: number;
  serviceFeeMinor: number;
  paidMinor: number;
}

export interface PosProvider {
  readonly name: string;
  /**
   * The POS calls Spot for changes instead of Spot calling it (1C exchange):
   * the outbox waits for its acknowledgements, and menu, tables and stock
   * come from what it uploaded.
   */
  readonly pulls?: boolean;
  /** A password is needed to call it. */
  readonly needsSecret?: boolean;
  /** Check and normalize connection settings; throws ZodError if they're wrong. */
  parseSettings?(settings: PosSettings): PosSettings;
  /** Menu as the POS knows it (import and linking). */
  getMenu(context: PosContext): Promise<PosMenu>;
  /** Tables as the POS knows them (linking). */
  getTables(context: PosContext): Promise<PosTable[]>;
  /** Stock for linked dishes (sold-out sync). */
  getStock(context: PosContext): Promise<PosStockLevel[]>;
  /** Send a new order to the kitchen through the POS; returns the POS's order id. */
  createOrder(context: PosContext, input: ExternalOrder): Promise<{ externalOrderId: string }>;
  updateOrder(context: PosContext, input: ExternalOrderUpdate): Promise<void>;
  /** The bill was paid on Spot: close the check in the POS. */
  closeBill(context: PosContext, input: CloseBillInput): Promise<void>;
}

/** A POS call that won't succeed by retrying (bad data, unknown dish): stop and report. */
export class PosPermanentError extends Error {
  override name = "PosPermanentError";
}
