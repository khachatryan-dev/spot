/*
 * Content Security Policy (§30 "Secure headers"). Pages get a fresh nonce per
 * request (proxy.ts); Next.js puts it on its own scripts, and 'strict-dynamic'
 * lets those load the rest. Inline scripts an attacker injects have no nonce
 * and don't run. Styles allow 'unsafe-inline' because UI libraries set style
 * attributes; that is far lower risk than script.
 */

const ABLY = ["*.ably.io", "*.ably.net", "*.ably-realtime.com"];
/** Map tiles, fonts and sprites (OpenFreeMap, OpenStreetMap data). */
export const MAP_TILES = "https://tiles.openfreemap.org";

export interface CspOptions {
  nonce: string;
  /** Development needs 'unsafe-eval' for React's error overlay. */
  isDev: boolean;
  /** Public base URL of uploaded images (NEXT_PUBLIC_STORAGE_URL). */
  storageUrl?: string;
  /** Browser Sentry DSN (NEXT_PUBLIC_SENTRY_DSN); its host receives error reports. */
  sentryDsn?: string;
  /** Realtime is on (ABLY_API_KEY set): browsers connect to Ably. */
  realtime: boolean;
}

const originOf = (url: string | undefined) => {
  if (!url) return [];
  try {
    return [new URL(url).origin];
  } catch {
    return [];
  }
};

export function buildCsp({ nonce, isDev, storageUrl, sentryDsn, realtime }: CspOptions) {
  const connect = [
    "'self'",
    MAP_TILES,
    ...originOf(sentryDsn),
    ...(realtime ? ABLY.flatMap((host) => [`https://${host}`, `wss://${host}`]) : []),
  ];
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    ["img-src 'self' blob: data:", MAP_TILES, ...originOf(storageUrl)].join(" "),
    // The map's web worker is a file we serve (MapLibre's CSP build).
    "worker-src 'self'",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

/** A random, single-use nonce (128 bits, base64). Works in Node and the edge runtime. */
export function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** Headers for every response, pages and API alike (next.config.ts). */
export const SECURITY_HEADERS = [
  // Browsers ignore HSTS over plain http, so this is safe locally.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Never send full URLs (QR or invite tokens) to other sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self), browsing-topics=()",
  },
];
