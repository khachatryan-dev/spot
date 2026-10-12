import { describe, expect, it } from "vitest";

import { buildCsp, createNonce, MAP_TILES, SECURITY_HEADERS } from "./csp";

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(`${name} `));

describe("buildCsp", () => {
  const base = { nonce: "abc123", isDev: false, realtime: false };

  it("allows only our own scripts carrying this request's nonce", () => {
    const csp = buildCsp(base);
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    // The map's worker is our own file; no blob: or inline workers.
    expect(directive(csp, "worker-src")).toBe("worker-src 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("adds 'unsafe-eval' only in development", () => {
    expect(directive(buildCsp({ ...base, isDev: true }), "script-src")).toContain("'unsafe-eval'");
    expect(buildCsp({ ...base, isDev: true })).not.toContain("upgrade-insecure-requests");
  });

  it("allows images from the storage origin and errors to the Sentry host", () => {
    const csp = buildCsp({
      ...base,
      storageUrl: "https://images.spot.am/uploads/",
      sentryDsn: "https://key@o1.ingest.sentry.io/42",
    });
    expect(directive(csp, "img-src")).toBe(
      `img-src 'self' blob: data: ${MAP_TILES} https://images.spot.am`,
    );
    expect(directive(csp, "connect-src")).toBe(
      `connect-src 'self' ${MAP_TILES} https://o1.ingest.sentry.io`,
    );
  });

  it("connects to Ably only when realtime is on", () => {
    expect(directive(buildCsp(base), "connect-src")).toBe(`connect-src 'self' ${MAP_TILES}`);
    const live = directive(buildCsp({ ...base, realtime: true }), "connect-src");
    expect(live).toContain("https://*.ably.io");
    expect(live).toContain("wss://*.ably.io");
  });

  it("ignores a malformed URL instead of breaking the policy", () => {
    expect(directive(buildCsp({ ...base, storageUrl: "not a url" }), "img-src")).toBe(
      `img-src 'self' blob: data: ${MAP_TILES}`,
    );
  });
});

describe("createNonce", () => {
  it("is random base64 of 128 bits", () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});

describe("SECURITY_HEADERS", () => {
  it("covers the standard protections", () => {
    expect(SECURITY_HEADERS.map((h) => h.key)).toEqual(
      expect.arrayContaining([
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "X-Frame-Options",
        "Permissions-Policy",
      ]),
    );
  });
});
