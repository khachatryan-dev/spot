/**
 * Return `path` only if it is a same-site path, otherwise `fallback`.
 * Prevents open redirects via `?next=https://evil.example` or `//evil.example`.
 */
export function safeRedirectPath(path: string | null | undefined, fallback: string): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return fallback;
  }
  try {
    // Anything that resolves to another origin (e.g. "/\t/evil.example") is rejected.
    const base = "http://same.origin";
    const url = new URL(path, base);
    if (url.origin !== base || url.pathname.startsWith("/api/")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
