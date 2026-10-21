import { routing } from "@/i18n/routing";

/**
 * What a scanned QR code may open: only one of our table links
 * (`<our origin>/t/<token>`, optionally with a language prefix). Anything
 * else — other sites, other pages of ours — is refused, so a sticker over a
 * table code can't send guests somewhere unexpected.
 */
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export function tablePathFromScan(text: string, ourOrigins: string[]): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const origins = ourOrigins.map((o) => new URL(o).origin);
  if (!origins.includes(url.origin)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const hasLocale =
    parts.length === 3 && (routing.locales as readonly string[]).includes(parts[0]!);
  const [t, token] = hasLocale ? parts.slice(1) : parts;
  if (parts.length !== (hasLocale ? 3 : 2) || t !== "t" || !token || !TOKEN.test(token)) {
    return null;
  }
  return `/t/${token}`;
}
