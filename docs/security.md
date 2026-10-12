# Security review — headers, CSRF, rate limits (§30)

Reviewed on Day 51 (2026-10-07). Update this when adding an endpoint, a cookie
or a third-party origin.

## Security headers

| Header                     | Value                                                                                | Where                                                         |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Content-Security-Policy    | per-request nonce, `'strict-dynamic'`, `frame-ancestors 'none'`, `object-src 'none'` | pages — `src/proxy.ts`, built by `src/shared/security/csp.ts` |
| Strict-Transport-Security  | 2 years, subdomains, preload                                                         | all — `next.config.ts`                                        |
| X-Content-Type-Options     | `nosniff`                                                                            | all                                                           |
| Referrer-Policy            | `strict-origin-when-cross-origin` (QR/invite tokens never leave in a referrer)       | all                                                           |
| X-Frame-Options            | `DENY`                                                                               | all                                                           |
| Cross-Origin-Opener-Policy | `same-origin`                                                                        | all                                                           |
| Permissions-Policy         | camera, microphone, payment, usb off; geolocation same-origin only                   | all                                                           |
| X-Powered-By               | removed                                                                              | all                                                           |

The CSP allows, beyond `'self'`: map tiles, fonts and sprites from
`https://tiles.openfreemap.org` (OpenStreetMap; no key), the map's web worker
as our own file (`worker-src 'self'`, MapLibre's CSP build copied to
`public/vendor` on install), images from `NEXT_PUBLIC_STORAGE_URL`, error
reports to the `NEXT_PUBLIC_SENTRY_DSN` host, and Ably (`*.ably.io`,
`*.ably.net`, `*.ably-realtime.com`) only when `ABLY_API_KEY` is set. **A new
third-party script, image host or API must be added in `csp.ts`.**

Because of the nonce, every page renders per request (`connection()` in the
root layout). A page prerendered at build time would have its scripts blocked.
`e2e/security.spec.ts` guards this.

## CSRF

| Entry point                                                                                                                   | Protection                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server Actions                                                                                                                | Next.js compares `Origin` with the host (built in)                                                                                                                                     |
| Route handlers that change data (`/api/restaurants/*/images`, `/api/restaurants/*/menu-items/*/image`, `/api/realtime/token`) | `assertSameOrigin` — a missing or foreign `Origin` is refused (403)                                                                                                                    |
| `/api/auth/*`                                                                                                                 | Better Auth's own origin check against `baseURL`                                                                                                                                       |
| `POST /api/payments/webhooks/<provider>`                                                                                      | Provider signature (HMAC, constant-time); body capped at 64 KB; no cookies. The payment is re-verified with the provider before any change, and each provider event id is applied once |
| `GET /t/<token>` (QR scan)                                                                                                    | Side effect by design: a camera app opens it cross-site. It can only join you to a table whose code the visitor already has; rate limited                                              |
| Cookies                                                                                                                       | `httpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix in production                                                                                                                  |

No GET handler other than the QR scan and the scheduled jobs changes data.
The test payment page (`/dev/pay/*`) and its action exist only while the fake
provider is active (development, or `PAYMENT_PROVIDER=fake` for E2E); they
return 404 otherwise, and only send guests back to our own URLs.
Scheduled jobs (`/api/cron/*`) require `Authorization: Bearer $CRON_SECRET`
(compared in constant time) and return 404 when no secret is configured.

## Rate limits

Stored in Postgres (`rate_limits`), shared by all server instances.

| What                         | Limit           | Key                                   |
| ---------------------------- | --------------- | ------------------------------------- |
| Sign in                      | 5 / minute      | IP (Better Auth)                      |
| Sign up                      | 5 / hour        | IP (Better Auth)                      |
| Password reset request       | 3 / hour        | IP (Better Auth)                      |
| Other auth endpoints         | 100 / minute    | IP (Better Auth)                      |
| QR scan                      | 60 / minute     | IP (a restaurant often shares one IP) |
| Place order                  | 10 / 10 minutes | table session                         |
| Table request (bill, waiter) | 15 / 10 minutes | table session                         |
| Image upload                 | 30 / 10 minutes | user                                  |
| Realtime token               | 60 / minute     | IP                                    |

Client IPs come from `x-forwarded-for`, which Vercel sets itself. Behind a
different proxy, make sure it overwrites that header rather than appending to
a client-supplied one.

## Already covered elsewhere

Tenant isolation (composite foreign keys), RBAC inside every service, Zod on
every input, server-side pricing, idempotent orders, append-only audit log,
hashed guest/invite tokens, upload re-encoding (no SVG), secrets only in
server env. Webhook signatures arrive with payments (Phase 9).

## POS integrations

A POS password (1C HTTP service) is stored encrypted (AES-256-GCM, key
derived from `AUTH_SECRET`; rotating it means re-entering POS passwords) and
never returned to the browser. A 1C that calls Spot authenticates with a
random exchange token stored only as a SHA-256 hash, rate-limited per
connection, with bodies capped at 2 MB. Spot calls POS URLs only over https
to public addresses: private, loopback and link-local IPs are refused when
the host name is resolved at connect time (no DNS rebinding), redirects are
not followed, and answers are capped at 2 MB (`server/http/outbound.ts`).
POS calls never
happen inside a guest or staff request's critical path: changes are queued
after they are committed and sent in the background, so a slow or hostile
POS can't block ordering. The in-memory test POS doesn't exist in a
production build.
