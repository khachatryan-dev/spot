# Deploying staging

Staging = the app on **Vercel**, a **PostgreSQL** database, images on
**Cloudflare R2**, and optionally **Ably** (realtime) and **Sentry** (errors).
Redis is not needed: rate limits live in Postgres.

Do the steps in order; each one gives you values for the table in step 6.

## 1. Code on GitHub

Create an **empty private** repository on GitHub (no README), then:

```bash
git remote add origin git@github.com:<you>/spot.git
git push -u origin main
```

## 2. PostgreSQL

Any PostgreSQL 15+ that Vercel can reach over the internet works.

### Option A — your own server (e.g. GoDaddy)

- It must be a **VPS** (virtual private server) with root access, Ubuntu 24.04.
  Shared web hosting can't run PostgreSQL.
- 2 GB RAM is enough for staging.
- Pick a data center near the Vercel region you'll use: Europe (Frankfurt,
  Vercel region `fra1`) is closest to Armenia.

On the server:

```bash
# PostgreSQL 17
sudo apt update && sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql-17

# Database and user (choose a long random password: openssl rand -base64 24)
sudo -u postgres psql -c "CREATE ROLE spot WITH LOGIN PASSWORD '<password>';"
sudo -u postgres psql -c "CREATE DATABASE spot OWNER spot;"
```

Allow connections from the internet **only over SSL** (Vercel has no fixed IP
addresses on the free plan, so the port must be open):

```bash
# /etc/postgresql/17/main/postgresql.conf
listen_addresses = '*'
ssl = on              # Ubuntu ships a self-signed certificate; fine for staging
max_connections = 100

# /etc/postgresql/17/main/pg_hba.conf — add at the end:
hostssl spot spot 0.0.0.0/0 scram-sha-256
hostssl spot spot ::/0      scram-sha-256

sudo systemctl restart postgresql
sudo ufw allow OpenSSH && sudo ufw allow 5432/tcp && sudo ufw enable
```

Daily backups (kept 14 days):

```bash
sudo mkdir -p /var/backups/spot && sudo chown postgres /var/backups/spot
echo '0 3 * * * postgres pg_dump -Fc spot > /var/backups/spot/spot-$(date +\%F).dump && find /var/backups/spot -mtime +14 -delete' | sudo tee /etc/cron.d/spot-backup
```

Connection string (note `sslmode=require`):

```
DATABASE_URL=postgresql://spot:<password>@<server-ip>:5432/spot?sslmode=require
```

`sslmode=require` encrypts the connection but doesn't verify the self-signed
certificate. **Before real customers**, install a proper certificate (e.g. from
Let's Encrypt for a hostname like `db.example.am`) and use
`sslmode=verify-full`.

You're responsible for this server's security updates
(`sudo apt install unattended-upgrades`).

### Option B — managed (no server to look after)

**Neon** has a free tier: on the Vercel project, go to Storage → Connect
Database → Neon, and `DATABASE_URL` is set for you.

Either way, the tables are created automatically on the first deploy
(`scripts/migrate.mjs` runs before every build of `main`).

## 3. Images — Cloudflare R2 (free up to 10 GB)

1. Cloudflare dashboard → **R2** → Create bucket `spot-staging`.
2. Bucket → Settings → **Public access** → enable the `r2.dev` subdomain.
   Copy the public URL (`https://pub-….r2.dev`).
3. R2 → **Manage API tokens** → Create token with **Object Read & Write** on
   that bucket. Copy the _Access Key ID_, the _Secret Access Key_ and the
   _S3 endpoint_ (`https://<account-id>.r2.cloudflarestorage.com`).

## 4. Realtime — Ably (free: 6M messages/month)

ably.com → sign up → create an app `spot-staging` → **API Keys** → copy the
root key (`xxxx.yyyy:zzzz`). Without it, screens refresh every 10–15 s.

## 5. Errors — Sentry (free: 5k errors/month)

sentry.io → sign up → create a **Next.js** project → copy the **DSN**.

## 5b. Email (later)

No email service is configured yet: every email (booking confirmations,
reminders, refunds, review confirmations) is written to the `email_messages`
table with status `logged` and not sent. When you choose Resend or SMTP,
only `src/server/email/sender.ts` changes.

## 6. Vercel project

vercel.com → **Add New → Project** → import the GitHub repository.

- Framework: Next.js (detected). Build command comes from `vercel.json`.
- **Settings → Functions → Region:** `fra1` (or the one nearest your database).
- **Settings → Environment Variables** (Production), before the first deploy.
  `NEXT_PUBLIC_*` values are built into the page, so changing them needs a
  redeploy.

| Variable                                    | Value                                             |
| ------------------------------------------- | ------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                       | `https://<project>.vercel.app` (your staging URL) |
| `AUTH_URL`                                  | same as `NEXT_PUBLIC_APP_URL`                     |
| `AUTH_SECRET`                               | output of `openssl rand -base64 32`               |
| `DATABASE_URL`                              | from step 2                                       |
| `DATABASE_POOL_MAX`                         | `3`                                               |
| `STORAGE_ENDPOINT`                          | R2 S3 endpoint                                    |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | R2 token                                          |
| `STORAGE_BUCKET`                            | `spot-staging`                                    |
| `STORAGE_REGION`                            | `auto`                                            |
| `NEXT_PUBLIC_STORAGE_URL`                   | R2 public URL (`https://pub-….r2.dev`)            |
| `ABLY_API_KEY`                              | optional, step 4                                  |
| `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`   | optional, step 5 (same DSN)                       |
| `LOG_LEVEL`                                 | `info`                                            |
| `CRON_SECRET`                               | output of `openssl rand -base64 32`               |
| `PAYMENT_PROVIDER`                          | **leave empty** (no real provider yet)            |

`vercel.json` schedules `/api/cron/reservations` once a day (03:00 UTC), the
most the Hobby plan allows; Vercel calls it with `CRON_SECRET`. It tidies up
expired reservation requests; screens already do this for what they show, so
a daily run is enough. On the Pro plan you can make it every 15 minutes.

`/api/cron/pos` (same `CRON_SECRET`) retries changes that didn't reach a
restaurant's POS and follows POS stock. New orders go to the POS right away,
so it only matters once a location is connected to a POS; then schedule it
every few minutes (Vercel Pro, or a server cron with
`curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/pos`). The
daily job runs it too.

Never set `PAYMENT_PROVIDER=fake` on a real deployment: it accepts test
payments where no money moves (E2E only). With it empty, online payments are
off and restaurants can't switch on reservation deposits.

Then **Deploy**. Every push to `main` deploys again; other branches get
preview deploys that don't touch the database.

## 7. Check it works

1. `https://<staging>/api/health` returns `{"data":{"status":"ok",…}}`.
2. Register your own account, then make it a platform admin:
   `psql "$DATABASE_URL" -c "UPDATE users SET platform_role = 'platform_admin' WHERE email = '<you>';"`
3. Walk the whole flow on a phone (README → "First run"): restaurant, admin
   approval, menu with a photo, tables, QR, order from a second phone, kitchen,
   bill request.
4. With Ably on: the order board and the guest's page update within a second,
   without waiting for the 10–15 s refresh.
