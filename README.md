# Spot

Restaurant digital platform — see `bus.md` (spec) and `ROADMAP.md` (daily plan).

## Requirements

- Node.js 20.9+ (22 LTS recommended)
- PostgreSQL 17 and Redis 7

## Local setup

```bash
npm install
cp .env.example .env.local
```

Start Postgres and Redis — **either** with Homebrew:

```bash
brew install postgresql@17 redis
brew services start postgresql@17 && brew services start redis
/opt/homebrew/opt/postgresql@17/bin/psql -d postgres \
  -c "CREATE ROLE spot WITH LOGIN PASSWORD 'spot' CREATEDB;" \
  -c "CREATE DATABASE spot OWNER spot;" \
  -c "CREATE DATABASE spot_test OWNER spot;"
```

**or** with Docker:

```bash
docker compose up -d
docker compose exec postgres createdb -U spot spot_test
```

`spot_test` is used by integration tests (`*.int.test.ts`), which migrate it automatically.

File uploads use S3-compatible storage. Locally, run MinIO:

```bash
brew install minio minio-mc && brew services start minio
mc alias set local http://localhost:9000 minioadmin minioadmin
for b in spot-uploads spot-uploads-test; do mc mb --ignore-existing local/$b && mc anonymous set download local/$b; done
```

In production, point the `STORAGE_*` variables at Cloudflare R2 or AWS S3 and set
`NEXT_PUBLIC_STORAGE_URL` to the bucket's public URL or CDN.

Then:

```bash
npm run db:migrate
npm run dev          # http://localhost:3000 — health check at /api/health
```

## Scripts

| Script                     | What it does                                                          |
| -------------------------- | --------------------------------------------------------------------- |
| `npm run dev`              | Start dev server                                                      |
| `npm run check`            | Typecheck + lint + format check + unit/integration tests              |
| `npm run test:e2e`         | Playwright journeys on a production build (port 3210, `spot_test` DB) |
| `npm run format`           | Fix formatting                                                        |
| `npm run db:generate`      | Create a migration from schema changes                                |
| `npm run db:migrate`       | Apply migrations                                                      |
| `npm run db:studio`        | Browse the database                                                   |
| `npm run db:export-schema` | Rebuild `docs/db/schema.sql` after adding a migration                 |

## First run: try the whole flow

1. Register at `/register` and create a restaurant at `/dashboard/new`; add a
   location, a menu and tables, create QR codes, then **Submit for review**.
2. Make yourself a platform admin and approve it at `/admin`:

   ```bash
   /opt/homebrew/opt/postgresql@17/bin/psql -d spot -c "UPDATE users SET platform_role = 'platform_admin' WHERE email = 'you@example.com';"
   ```

3. Open a table's QR link (Tables → QR code) in another browser or a private
   window, order, and follow it on the Orders and Kitchen screens.

## Optional services

All are off when their variables are empty; the app still works.

| Service                  | Variables                                  | Without it                               |
| ------------------------ | ------------------------------------------ | ---------------------------------------- |
| Realtime (Ably)          | `ABLY_API_KEY`                             | screens refresh by polling every 10–15 s |
| Error reporting (Sentry) | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`     | errors only in server logs               |
| Google sign-in           | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | email and password only                  |

## Docs

- `docs/setup-at-home.md` — the owner's to-do list: GitHub, accounts, staging, decisions.
- `docs/db/` — the whole database as SQL (`schema.sql`) and how to load it.
- `.env.example` (local) and `.env.production.example` (servers) — every setting, explained.
- `docs/deploy.md` — deploying staging (Vercel, Postgres, R2, Ably, Sentry).
- `docs/adr/` — architecture decisions (realtime transport).
- `docs/security.md` — headers and CSP, CSRF, rate limits. **Adding a
  third-party script, image host or API? Allow it in `src/shared/security/csp.ts`.**
