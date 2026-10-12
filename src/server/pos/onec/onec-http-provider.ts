import { z } from "zod";

import { assertPublicHttpsUrl, type OutboundTransport } from "@/server/http/outbound";

import { type PosContext, PosPermanentError, type PosProvider } from "../provider";
import {
  billClosedDocument,
  catalogSchema,
  type ChangeDocument,
  changeResultSchema,
  EXCHANGE_VERSION,
  orderCreatedDocument,
  orderStatusDocument,
  stockSchema,
} from "./exchange-format";

/*
 * 1C that publishes an HTTP service implementing the Spot exchange format
 * (docs/pos-1c.md). Spot calls it with Basic auth:
 *   GET  {baseUrl}/v1/catalog   menu items and tables
 *   GET  {baseUrl}/v1/stock     portions left
 *   POST {baseUrl}/v1/changes   one change document → { ok, externalId? }
 * Wrong address, credentials or data won't fix themselves (stop and report);
 * timeouts, 429 and 5xx are retried by the outbox.
 */

const settingsSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => {
      try {
        assertPublicHttpsUrl(v);
        return true;
      } catch {
        return false;
      }
    }, "publicHttpsUrl")
    .transform((v) => v.replace(/\/+$/, "")),
  username: z.string().trim().min(1).max(100),
});

const RETRYABLE = new Set([408, 425, 429]);

export function createOneCHttpProvider(transport: OutboundTransport): PosProvider {
  async function call(context: PosContext, method: "GET" | "POST", path: string, body?: unknown) {
    const { baseUrl, username } = settingsSchema.parse(context.settings);
    if (!context.secret) throw new PosPermanentError("The 1C password is missing. Enter it again.");
    const response = await transport({
      method,
      url: `${baseUrl}${path}`,
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${context.secret}`).toString("base64")}`,
        accept: "application/json",
        "x-spot-exchange-version": String(EXCHANGE_VERSION),
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status >= 500 || RETRYABLE.has(response.status)) {
      throw new Error(`1C answered ${response.status}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new PosPermanentError("1C refused the user name or password.");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new PosPermanentError(`1C answered ${response.status}`);
    }
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      throw new PosPermanentError("1C's answer isn't JSON.");
    }
  }

  const parse = <T>(schema: z.ZodType<T>, value: unknown, what: string): T => {
    const result = schema.safeParse(value);
    if (!result.success) throw new PosPermanentError(`1C sent ${what} Spot can't read.`);
    return result.data;
  };

  async function send(context: PosContext, document: ChangeDocument) {
    const result = parse(
      changeResultSchema,
      await call(context, "POST", "/v1/changes", document),
      "an answer",
    );
    if (!result.ok) {
      if (result.retry) throw new Error(result.error);
      throw new PosPermanentError(result.error);
    }
    return result;
  }

  return {
    name: "1c",
    needsSecret: true,
    parseSettings: (settings) => settingsSchema.parse(settings),

    async getMenu(context) {
      const catalog = parse(catalogSchema, await call(context, "GET", "/v1/catalog"), "a menu");
      return { items: catalog.items };
    },
    async getTables(context) {
      return parse(catalogSchema, await call(context, "GET", "/v1/catalog"), "a menu").tables;
    },
    async getStock(context) {
      return parse(stockSchema, await call(context, "GET", "/v1/stock"), "stock").stock;
    },

    async createOrder(context, input) {
      const result = await send(context, orderCreatedDocument(input.idempotencyKey, input));
      if (!result.externalId) throw new PosPermanentError("1C didn't return its order id.");
      return { externalOrderId: result.externalId };
    },
    async updateOrder(context, input) {
      await send(context, orderStatusDocument(input.idempotencyKey, input));
    },
    async closeBill(context, input) {
      await send(context, billClosedDocument(input.idempotencyKey, input));
    },
  };
}
