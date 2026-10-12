import "server-only";

import { lookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

import { Agent, fetch } from "undici";

/*
 * Calls to addresses that restaurant staff type in (a POS's URL). Only
 * public HTTPS hosts: private, loopback and link-local addresses are refused
 * when the name is resolved — at connect time, so DNS tricks can't swap in
 * an internal address afterwards. No redirects, short timeouts, capped
 * response size.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** Is this IP address on the public internet? */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !blocked.check(address, "ipv6");
  }
  return !blocked.check(address, "ipv4");
}

export class OutboundError extends Error {
  override name = "OutboundError";
}

const agent = new Agent({
  headersTimeout: 10_000,
  bodyTimeout: 10_000,
  connect: {
    timeout: 5_000,
    lookup(hostname, options, callback) {
      lookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
        if (error) return callback(error, "", 0);
        const safe = addresses.filter((a) => isPublicAddress(a.address));
        if (safe.length === 0 || safe.length !== addresses.length) {
          return callback(new OutboundError(`${hostname} isn't a public address.`), "", 0);
        }
        if ((options as { all?: boolean }).all) {
          return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, safe);
        }
        callback(null, safe[0]!.address, safe[0]!.family);
      });
    },
  },
});

export interface OutboundRequest {
  method: "GET" | "POST" | "PUT";
  url: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface OutboundResponse {
  status: number;
  body: string;
}
export type OutboundTransport = (request: OutboundRequest) => Promise<OutboundResponse>;

/** Refuse anything but https:// on a host name or public IP. */
export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundError("Not a valid URL.");
  }
  if (url.protocol !== "https:") throw new OutboundError("Only https:// addresses are allowed.");
  if (url.username || url.password)
    throw new OutboundError("Put credentials in the password field.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) {
    throw new OutboundError(`${host} isn't a public address.`);
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new OutboundError(`${host} isn't a public address.`);
  }
  return url;
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** The real network transport, with the protections above. */
export const outboundFetch: OutboundTransport = async (request) => {
  const url = assertPublicHttpsUrl(request.url);
  const response = await fetch(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "error",
    dispatcher: agent,
    signal: AbortSignal.timeout(15_000),
  });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new OutboundError("The response is too large.");
    }
    chunks.push(value);
  }
  return { status: response.status, body: Buffer.concat(chunks).toString("utf8") };
};
