import type { OutboundRequest, OutboundTransport } from "@/server/http/outbound";
import type { ChangeDocument } from "@/server/pos/onec/exchange-format";

/*
 * A stand-in 1C HTTP service implementing the Spot exchange format, as a
 * transport (no network). Tests set its catalog and stock, read what it
 * received, and make it answer with errors.
 */
export function createFakeOneC(options: { username?: string; password?: string } = {}) {
  const auth = `Basic ${Buffer.from(`${options.username ?? "spot"}:${options.password ?? "secret-1c"}`).toString("base64")}`;
  const state = {
    catalog: { items: [] as unknown[], tables: [] as unknown[] },
    stock: [] as unknown[],
    received: [] as ChangeDocument[],
    requests: [] as OutboundRequest[],
    /** Next answers to give instead of the normal one. */
    nextResponses: [] as { status: number; body: string }[],
  };
  const applied = new Map<string, string>();

  const transport: OutboundTransport = async (request) => {
    state.requests.push(request);
    const queued = state.nextResponses.shift();
    if (queued) return queued;
    if (request.headers?.authorization !== auth) return { status: 401, body: "" };
    const path = new URL(request.url).pathname.replace(/^\/[^/]*\/hs\/spot/, "");
    const json = (value: unknown) => ({ status: 200, body: JSON.stringify(value) });
    if (request.method === "GET" && path === "/v1/catalog") return json(state.catalog);
    if (request.method === "GET" && path === "/v1/stock") return json({ stock: state.stock });
    if (request.method === "POST" && path === "/v1/changes") {
      const document = JSON.parse(request.body ?? "{}") as ChangeDocument;
      // Same change id again → same answer, applied once.
      if (!applied.has(document.changeId)) {
        state.received.push(document);
        applied.set(document.changeId, `1c-${applied.size + 1}`);
      }
      return json({
        ok: true,
        ...(document.type === "order.created" && { externalId: applied.get(document.changeId) }),
      });
    }
    return { status: 404, body: "" };
  };
  return { transport, state };
}
