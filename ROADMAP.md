# Implementation Roadmap

Daily plan for building the platform described in `bus.md`.

Each day is **one small, focused task** sized to use roughly **2–3% of usage limits**.
Tasks are in order — each day builds on the previous one.

---

## How to use this file (important for saving limits)

1. **One fresh session per day.** Start a new Claude Code session (or run `/clear`) before each day. Long sessions cost more.
2. **Use the daily prompt** (below). Do not say "read bus.md" — it is ~2,100 lines and expensive. Each day lists only the sections that are needed.
3. **Stop when the day is done.** Don't add extra tasks in the same session.
4. **Use a cheaper model for simple days.** Days marked 🟢 are routine (UI, CRUD, config) — switch with `/model` to Sonnet. Days marked 🔴 are critical logic (money, security, concurrency) — use the strongest model.
5. **If a day is too big**, split it into "Day Na" and "Day Nb" — don't force it.
6. After each day: tick the box `[x]` and commit. Mark the phase heading ⏳ while in progress and ✅ when all its days are done.

### Token estimates

Each day shows an estimated token count, e.g. `~250k`. This is the **total tokens processed in that session**
(input + output; most input is cached context re-read each turn, which counts much less against limits than new output).

| Type | Typical tokens | Example |
|------|----------------|---------|
| 🟢 routine | ~150k | config, CRUD pages, simple UI |
| 🟡 medium | ~250k | schema + migration, API + page |
| 🔴 critical | ~400k | money, security, concurrency, with tests |

**Whole MVP (Days 0–53): ≈ 13.7M tokens.**

These are **estimates, not measurements**. Real usage depends on how many fixes/retries a day needs.
Write the real number in the Progress log after each day — after ~5 days you'll know how many tokens equal 2–3% of your limit, and can make days bigger or smaller.

### Daily prompt (copy-paste)

```
Do Day <N> from ROADMAP.md.
Read only the bus.md sections listed for that day, and only the files you need.
When done: run typecheck, lint and tests, tick the box in ROADMAP.md, commit, and stop.
Keep the summary short.
```

---

## ✅ Day 0 — Preparation (one time) 🟢 `~100k`

- [x] Create a **short** `CLAUDE.md` (~40 lines): stack, key rules from §46–49, pointer to `bus.md` and `ROADMAP.md`.
  Do NOT rename `bus.md` to `CLAUDE.md` — `CLAUDE.md` is loaded into every session, so a 2,100-line file would eat limits every day.
- [x] Remove the stray `'''` at the end of `bus.md`.

---

## ✅ Phase 1 — Foundation (Days 1–7) — ≈ 1.2M tokens

- [x] **Day 1** 🟢 `~200k` — Create Next.js app (TypeScript, App Router, `src/`, Tailwind v4). `git init`, `.gitignore`, strict `tsconfig`. *(§5, §7)*
- [x] **Day 2** 🟢 `~200k` — ESLint + Prettier, scripts `typecheck` / `lint` / `test`. Init shadcn/ui and add base components (Button, Input, Card, Dialog, Badge, Skeleton, Toast). *(§36)*
- [x] **Day 3** 🟢 `~150k` — Environment config validated with Zod (`src/shared/config/env.ts`) + `.env.example`. *(§50)*
- [x] **Day 4** 🟢 `~150k` — `docker-compose.yml` for local Postgres + Redis. Drizzle setup: client, `drizzle.config.ts`, migration scripts. *(§32, §48)*
- [x] **Day 5** 🟡 `~250k` — Vitest setup. Typed `AppError` codes + API response helpers `{ data, error }` + tests. *(§33, §34)*
- [x] **Day 6** 🟢 `~150k` — Structured logger (no secrets in logs). Sentry skeleton (DSN optional). *(§41)*
- [x] **Day 7** 🟢 `~150k` — i18n setup (Armenian + English), route-group layouts: `(marketing)`, `(customer)`, `(restaurant)`, `(admin)`. *(§38, §7)*

## ✅ Phase 2 — Authentication & RBAC (Days 8–13) — ≈ 2M tokens

- [x] **Day 8** 🟡 `~250k` — `users` + `roles` schema and migration. *(§9, §32)*
- [x] **Day 9** 🔴 `~400k` — Better Auth (chosen over Auth.js v5 beta) with email/password, database sessions, rate limiting. *(§5 Authentication)*
- [x] **Day 10** 🟢 `~150k` — Google OAuth + login / register pages (with loading/error states).
- [x] **Day 11** 🔴 `~400k` — Guest session (cookie) for QR customers — no account needed. *(§25)*
- [x] **Day 12** 🔴 `~400k` — `restaurant_staff` schema, permission map per role, policy helpers + tests. *(§9)*
- [x] **Day 13** 🔴 `~400k` — Server helpers `requireUser()`, `requireRestaurantRole()`; route protection. *(§30)*

## ✅ Phase 3 — Restaurant (Days 14–22) — ≈ 2.1M tokens

- [x] **Day 14** 🟡 `~250k` — Extend `restaurants` (minimal table + status enum created on Day 12) with profile fields; add `restaurant_locations`. *(§10, §11)*
- [x] **Day 15** 🔴 `~400k` — Restaurant service + repository with tenant scoping + tests. *(§8)*
- [x] **Day 16** 🟢 `~150k` — Onboarding form: create restaurant (DRAFT) → first location → submit for review (PENDING_REVIEW). Playwright set up early with an onboarding E2E test.
- [x] **Day 17** 🟢 `~150k` — Restaurant profile edit page.
- [x] **Day 18** 🟢 `~150k` — Locations CRUD: address, phone, opening hours, coordinates (manual input; Mapbox later). *(§11)*
- [x] **Day 19** 🟡 `~250k` — Staff management: invite / change role / remove.
- [x] **Day 20** 🔴 `~400k` — File upload service (R2/S3) with MIME / size / extension validation. *(§31)*
- [x] **Day 21** 🟢 `~150k` — Basic admin: pending restaurants list + approve / reject. *(§10, §43 Platform)*
- [x] **Day 22** 🟡 `~250k` — `audit_logs` table + helper; log approvals and role changes. *(§49 #14)*

## ✅ Phase 4 — Menu (Days 23–28) — ≈ 1.2M tokens

- [x] **Day 23** 🟡 `~250k` — Schema: menus, categories, items, modifier groups, modifiers. *(§15)*
- [x] **Day 24** 🔴 `~400k` — Menu service (tenant-scoped) + tests.
- [x] **Day 25** 🟢 `~150k` — Category management UI (create, edit, sort).
- [x] **Day 26** 🟢 `~150k` — Item CRUD UI with image upload.
- [x] **Day 27** 🟢 `~150k` — Modifier groups UI (required / optional, min / max).
- [x] **Day 28** 🟢 `~150k` — Availability: active, out-of-stock, time-based, sort order.

## ✅ Phase 5 — Tables & QR (Days 29–34) — ≈ 1.8M tokens

- [x] **Day 29** 🟡 `~250k` — `tables` + `qr_tokens` schema. *(§12, §13)*
- [x] **Day 30** 🟢 `~150k` — Tables CRUD UI (number, capacity, zone, status).
- [x] **Day 31** 🔴 `~400k` — QR token service: crypto-random tokens, activate / revoke / rotate + tests. *(§13, §49 #5–6)*
- [x] **Day 32** 🟢 `~150k` — QR image generation + printable QR page.
- [x] **Day 33** 🔴 `~400k` — `/t/[token]` resolution + `table_sessions` / `table_session_members` schema + create/join logic. *(§13, §14)*
- [x] **Day 34** 🔴 `~400k` — Session management: staff view of active tables, close session, guests leave; scan rate limiting.

## ✅ Phase 6 — Ordering (Days 35–45) — ≈ 2.8M tokens

- [x] **Day 35** 🟢 `~150k` — Customer menu page under `/t/...` (mobile-first, categories). *(§35 Customer)*
- [x] **Day 36** 🟢 `~150k` — Item detail sheet with modifier selection.
- [x] **Day 37** 🟢 `~150k` — Cart (Zustand), per table session.
- [x] **Day 38** 🟡 `~250k` — Schema: orders, order_items, order_item_modifiers, order_status_history (price snapshots). *(§16)*
- [x] **Day 39** 🔴 `~400k` — Price calculation service (server-side only) + unit tests. *(§16, §49 #3)*
- [x] **Day 40** 🔴 `~500k` — Order creation service: all 11 steps from §16 in one transaction + integration test.
- [x] **Day 41** 🟡 `~250k` — Submit-order API + customer order status page.
- [x] **Day 42** 🟢 `~150k` — Restaurant order dashboard (desktop-first).
- [x] **Day 43** 🔴 `~400k` — Order status state machine (allowed transitions) + tests.
- [x] **Day 44** 🟢 `~150k` — Kitchen view (no customer personal data). *(§17)*
- [x] **Day 45** 🟡 `~250k` — Table requests (BILL, WAITER, WATER…): schema + service + UI both sides. *(§18)*

## ✅ Phase 7 — Realtime (Days 46–48) — ≈ 700k tokens

- [x] **Day 46** 🔴 `~200k` — **Decision day:** chose **Ably** (managed) — see `docs/adr/0001-realtime-transport.md`. Optional key; without it screens keep polling. *(§28, §53)*
- [x] **Day 47** 🟡 `~250k` — Publish order and table-request events as realtime hints (Ably) to location and table-session channels.
- [x] **Day 48** 🟡 `~250k` — Client subscriptions (token endpoint, LiveRefresh with polling fallback) on board, kitchen and guest pages. ⚠️ Live check with a real Ably key still pending.

## ⏳ MVP hardening & launch (Days 49–53) — ≈ 1.6M tokens

- [x] **Day 49** 🟡 `~350k` — E2E: QR → Menu → Cart → Order → Status (Playwright already set up on Day 16). *(§42)*
- [x] **Day 50** 🟡 `~350k` — E2E: Restaurant login → Menu → Table → QR → Order → Kitchen → Ready.
- [x] **Day 51** 🔴 `~400k` — Rate limiting, security headers, CSRF check. *(§30)*
- [x] **Day 52** 🟡 `~400k` — Review the "First production target" flow end to end; fix gaps. *(§56, §58)*
- [ ] **Day 53** 🟢 `~150k` — Deploy staging (Vercel + managed Postgres + Redis + R2); setup docs. *(§53)* ⏳ Prepared (build-time migrations, `docs/deploy.md`); waiting for the GitHub repo, a Postgres server and an R2 bucket.

🎉 **MVP done** — the §56 flow works. Test with 1–2 real restaurants before continuing.

---

## After MVP (each task ≈ 1 day; split further when planning)

### ✅ Phase 8 — Reservations (~8 days) *(§19, §20)* — ≈ 2.2M tokens
- [x] Schema: reservations, reservation_holds `~200k` — exclusion constraint forbids overlapping live holds on a table; location settings (confirmation mode, duration, notice, days ahead)
- [x] Availability service + tests 🔴 `~400k` — opening hours (incl. overnight) in the location's time zone, whole booking must fit before closing, 30-min steps, table size, live holds, blocked/inactive tables, notice and days-ahead
- [x] Hold + expiry (concurrency-safe, DB constraints) 🔴 `~400k` — 10-minute guest hold on the smallest free table; bookings per location serialized with an advisory lock (concurrent exclusion-constraint inserts can deadlock otherwise), the constraint stays the backstop; expired holds released in the same transaction, their pending reservations expire
- [x] Reservation creation + double-booking test 🔴 `~400k` — hold → reservation (auto: confirmed; manual: pending until staff answer, hold expires at the start time); double submit returns the same booking; no overlapping bookings per guest; audited
- [x] Customer reservation UI `~200k` — `/r/<restaurant>/<location>/reserve` (date, party, free times, 10-min hold with countdown, contact form; sign-in round trip keeps date and party) and `/reservations` (my bookings); E2E with accessibility checks
- [x] Restaurant reservation dashboard `~200k` — Reservations tab (per location and day, contact, table, status, live refresh), reservation settings on the location form, shareable booking link
- [x] Confirm / cancel / no-show / arrived / seated `~200k` — shared status rules (new `reservation:seat` for waiters), reasons shown to guests, ending statuses free the table, guests cancel until the start, audited and live
- [x] Expiry job `~200k` — screens expire overdue requests as they load (per location / per guest); `/api/cron/reservations` (bearer `CRON_SECRET`) sweeps everything daily via Vercel Cron; staff screens notified

### ⏳ Phase 9 — Payments (~7 days) *(§21)* — ≈ 2.2M tokens
- [x] PaymentProvider interface + PaymentService 🔴 `~400k` — provider-agnostic interface, in-memory fake provider (signed webhooks), forward-only status rules; status changes only after re-verifying with the provider; idempotent start; amount mismatch never marks paid
- [x] payments + payment_events schema `~200k` — done with the service: no deletes, locked amount/currency/provider (triggers), append-only events, provider event ids unique (webhook idempotency)
- [ ] Choose first provider (local Armenian provider?) — decision day `~200k` — ⏸ Deferred (2026-10-08): needs a registered business and a merchant contract; building webhooks, refunds and deposits on the fake provider first
- [ ] Provider implementation 🔴 `~400k`
- [x] Webhooks: signature + idempotency + tests 🔴 `~400k` — `POST /api/payments/webhooks/<provider>`: signature checked, body capped, payment re-verified with the provider (a webhook can't mark anything paid by itself), each event once, out-of-order safe; 5xx → provider retries
- [x] Refunds 🔴 `~400k` — reserve under a payment lock (refunds in flight count), call the provider with the refund's idempotency key, record the outcome; never over-refunds even concurrently; declines and mid-way failures are safe to retry; permanent records, audited (UI comes with billing)
- [x] Reservation deposits `~200k` — per guest or per booking (restaurant chooses); booking waits as pending_payment with a 15-min hold; confirmed only after the provider verifies; the accepted payment is recorded on the booking, any other paid deposit is refunded; refunds: restaurant cancel/decline always, guest before the cutoff (default 24 h), no-shows keep it; test payment page for dev/E2E

### ✅ Phase 10 — Billing & split bill (~5 days) *(§22, §23)* — ≈ 1.8M tokens
- [x] bills + bill_items schema (immutable when finalized) `~200k` — open → finalized → paid / void; triggers: no deletes, finalized amounts and lines locked, no reopening, lines must add up to the subtotal on finalizing, paid only after finalizing and in full; one live bill per visit
- [x] Bill generation from table session 🔴 `~400k` — open bill rebuilt from the visit's orders (cancelled/rejected excluded); per-location service charge, VAT-payer switch shows included 20 % VAT; staff finalize (not while the kitchen hasn't answered) → ordering stops; void (unpaid) for corrections; ordering and finalizing serialized so no order is lost; guest and staff bill pages
- [x] Equal split + pay own items 🔴 `~400k` — bill_payments (equal share / lines / rest; online or staff-recorded cash & terminal); every amount server-calculated, shares and lines held once (bill row lock + unique indexes), equal shares round down with the last taking the rest, unfinished online payments free their claim after 15 min and late money is refunded
- [x] Selected items + pay for another 🔴 `~400k` — item picker for guests and staff (any unpaid lines, quick "by person" buttons, live amount from the server's rule); guests see other guests only as "Guest N"; staff record cash/terminal for chosen lines
- [x] Remaining-balance tests (no double payment) 🔴 `~400k` — seeded random sequences (12 seeds × 30 steps: shares, lines, rest, online/cash/terminal, approvals, declines, timeouts, late money, rushes) with invariants checked after every step, plus a coverage check that every kind of payment happened; concurrent return + webhooks credit once

### ✅ Phase 11 — Reviews (~4 days) *(§24)* — ≈ 1M tokens
- [x] Schema + eligibility rules 🔴 `~400k` — reviews only for the author's own completed reservation or ended table visit where they were served (closed or bill paid), within 30 days, one each; anonymous guests must leave an email (verification with Phase 12 email); published at once
- [x] Customer review UI `~200k` — /reviews (rate visits with stars + comment; guests leave email and an optional name), prompts on the ended table page and My reservations, signed-in authors edit/delete, public rating summary + latest reviews (with replies) on the booking page
- [x] Restaurant response `~200k` — Reviews tab (review:respond: owners, managers) with average and every review; public reply (add/edit/remove), report to moderators with a reason (stays visible); audited
- [x] Admin moderation `~200k` — /admin/reviews (platform:reviews:moderate): reported queue first with a count badge, search, keep / hide / reject / restore with reasons, audited; hidden reviews leave the public rating at once

### ✅ Phase 12 — Customer accounts & discovery (~6 days) *(§25, §26, §39)* — ≈ 1.2M tokens
- [x] Customer profile, favorites, history `~200k` — /account (name, phone that pre-fills bookings, language), saved restaurants (heart on the restaurant page, "Book" links), visit history with what the guest spent and "Book again"; "My account" in the site header
- [x] Public restaurant page (SEO, metadata, structured data) `~200k` — /r/<restaurant>: cover, logo, description, cuisines, price level, rating + reviews, locations with hours, map link and Reserve, full menu; title/description, canonical + hreflang, Open Graph, schema.org Restaurant per location (escaped JSON-LD); approved restaurants only
- [x] Search + filters `~200k` — /restaurants: typo-tolerant name search (pg_trgm index), descriptions, cuisines by their name in any language; filters cuisine, price, city, takes reservations, open now (per location time zone); sort by rating / reviews / newest; "show more"; all in the URL; home-page search box and header link
- [x] Mapbox map + nearby `~200k` — MapLibre + OpenFreeMap instead of Mapbox (user's choice: free, no key): map view of results, "Near me" (asked on tap, rounded, URL only) sorting by distance with km on cards, owners tap the map to place a location's pin; CSP allows only the tile host and our own worker file
- [x] Sitemap + robots `~200k` — /sitemap.xml (home, restaurants, every approved restaurant; both languages with hreflang alternates, last-modified; read per request) and /robots.txt (private areas disallowed in both languages, sitemap link)
- [x] Notifications (in-app + email) *(§27)* `~200k` — bell + /notifications for staff and guests (booking requests, confirmations, declines, cancellations, deposit paid, refunds, review replies), email outbox with hy/en templates and day-of reminders via the daily job, anonymous reviewers confirm their email by link; emails are logged until an email service is chosen

### ✅ Phase 13 — Admin & analytics (~5 days) *(§4.2 metrics)* — ≈ 1M tokens
- [x] User management `~200k` — /admin/users: search by name/email, filters (suspended, admins, staff), restaurants and roles per person, joined/last sign-in; suspend with a reason (signed out everywhere at once, clear message at sign-in) and restore; can't suspend yourself, admins lock in order so two can't suspend each other; audited
- [x] Payment monitoring `~200k` — /admin/payments (platform:payments:read): problems first (amount mismatches, failed refunds, refunds and payments stuck over an hour), totals per currency (paid, refunded, failed, pending), filters (status, restaurant, dates), payment detail with provider reference, full event history, refunds and the booking/bill it paid for
- [x] PostHog events for key metrics `~200k` — our own analytics_events table instead of PostHog (user's choice: no third party, no cookie banner): QR scans, restaurant and booking page views, searches; anonymous keyed-hash visitor ids, crawlers and prefetches skipped, recorded after the response, deleted after 400 days; orders/reservations/visits/payments/reviews counted from their own tables
- [x] Restaurant analytics page `~200k` — Statistics tab (analytics:read: owners, managers): 7/30/90 days, per location; QR scans, visits, returning guests, page/booking views; orders, revenue, average, success rate; reservations, no-shows; rating; orders per day and by hour (accessible CSS charts with data tables), best sellers; local time zone
- [x] Platform analytics page `~200k` — /admin/stats (platform:analytics:read): active restaurants (QR scan, order, reservation, menu change or review), locations and tables; QR scans, orders, success rate, reservations; active, monthly active and returning customers counted once across scans/orders/bookings; restaurant retention vs the previous period; daily charts; busiest restaurants

### Phase 14 — Integrations (later) ⏳ *(§29)* — ≈ 600k tokens
- [x] POSProvider interface `~200k`
- [ ] First POS integration `~200k`
- [x] 1C adapter architecture `~200k`

### ✅ Phase 15 — Brand & public pages — ≈ 300k tokens
- [x] Warm orange theme, landing page with guest / restaurant entry points and reduced-motion-safe animations, About, Contact (form → `contact_messages`, admin `/admin/messages`), FAQ, Privacy, Terms, footer and sitemap `~300k` — company details are placeholders in `src/shared/config/company.ts`; legal texts need a lawyer's review
- [x] Owner onboarding `~200k` — restaurant sign-in / sign-up (`?for=restaurant`, branded guest vs restaurant panels, switch links), new owners land on "Create your restaurant", 6-step setup guide with progress on the dashboard
- [x] Guest table menu polish `~150k` — colourful table header with orders / bill buttons, dish cards with add cue and photo placeholder, self-centring category chips, livelier cart bar, order progress tracker, friendlier "scan the QR" and "menu closed" screens
- [x] Dashboard polish `~120k` — warm sidebar with logo and avatar, restaurant header with initial badge, pill tabs with icons, coloured restaurant status badges, shared `EmptyState` on orders, kitchen, reservations, menu, tables, reviews and locations
- [x] Admin polish `~80k` — header with logo and Admin chip, pill sections with icons and active state (`AdminNav`), pill filters, `EmptyState` on restaurants, payments, messages, audit and reviews, stat cards
- [x] Dark mode `~150k` — `next-themes` (follows the device, CSP nonce passed), sun/moon switch in auth, dashboard and admin headers and the public footer, dark partners for the brand colours; QR and print pages stay light

---

## Progress log

| Date | Day | Estimated | Actual tokens | Notes |
|------|-----|-----------|---------------|-------|
|      |     |           |               |       |
