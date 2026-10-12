@AGENTS.md

# Spot

Restaurant platform: QR table ordering, reservations, bills, reviews, admin.
Full spec: `bus.md` (read only the section you need). Plan and progress: `ROADMAP.md`.

## Stack

Next.js 16 (App Router, `proxy.ts`), React 19 + compiler, TypeScript strict,
Tailwind v4 + shadcn (base-nova), next-intl (`hy` default, `en` under `/en`),
Zod 4, Drizzle + PostgreSQL 17, Better Auth, Vitest (`*.int.test.ts` hit the
DB), Playwright (production build, mobile).

## Where things go

- Business logic: `src/server/services/*` — authorize first (`authorizeRestaurant`
  / `authorizePlatform`), validate with Zod, audit with `recordAudit(tx, …)`.
- Server actions wrap services in `action()`; routes use `route()` + `ok()`.
- Providers behind interfaces: payments `src/server/payments/`, POS `src/server/pos/`.
- Pure rules: `src/shared/domain/`. Money is integer minor units (AMD: 100 = 1 ֏).

## Rules (§46–49)

- Inspect before changing; reuse existing abstractions; keep it simple.
- No `any`, `@ts-ignore`, silenced lint, hardcoded secrets or prices.
- Never trust the client for prices, payment status, roles or ownership.
- No DB logic in UI components; no duplicated business logic.
- Every schema change is a Drizzle migration (`npm run db:generate`), then
  `npm run db:export-schema`; never delete financial or audit history.
- Invariants: tenant isolation, unpredictable/revocable QR tokens, no double
  table booking, unavailable items can't be ordered, orders keep historical
  prices, idempotent webhooks, critical changes audited.

## Workflow

- Ask the user before starting each roadmap part; one commit per part.
- Gate before commit: `npm run format && npm run check && npx playwright test`.
- Tick the box (and phase ✅/⏳) in `ROADMAP.md` when done.
- `PAYMENT_PROVIDER=fake` only for E2E, never on a real deployment.
