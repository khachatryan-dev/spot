import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";

import { isProtectedPath, localizePath, splitLocale } from "./i18n/paths";
import { routing } from "./i18n/routing";
import { buildCsp, createNonce } from "./shared/security/csp";

const intlMiddleware = createMiddleware(routing);

/**
 * 1. Fast, optimistic auth check: no session cookie on a protected page →
 *    redirect to login. This never touches the database; the real session
 *    and permission checks run in layouts, pages and server code (guards.ts).
 * 2. Locale routing (next-intl).
 * 3. Content Security Policy with a per-request nonce. Next.js reads the nonce
 *    from the request's CSP header while rendering and adds it to its scripts.
 */
export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { locale, path } = splitLocale(pathname);
  const csp = buildCsp({
    nonce: createNonce(),
    isDev: process.env.NODE_ENV === "development",
    storageUrl: process.env.NEXT_PUBLIC_STORAGE_URL,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    realtime: Boolean(process.env.ABLY_API_KEY),
  });

  let response: NextResponse;
  if (isProtectedPath(path) && !getSessionCookie(request, { cookiePrefix: "spot" })) {
    const login = new URL(localizePath("/login", locale), request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    // Dashboard visitors see the restaurant version of the sign-in page.
    if (path === "/dashboard" || path.startsWith("/dashboard/")) {
      login.searchParams.set("for", "restaurant");
    }
    response = NextResponse.redirect(login);
  } else {
    // next-intl forwards the incoming request headers, so add the CSP there.
    const headers = new Headers(request.headers);
    headers.set("content-security-policy", csp);
    response = intlMiddleware(new NextRequest(request, { headers }));
  }
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Everything except API routes, Next internals, Vercel internals and files with an extension.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
