# Your to-do list (at home)

Everything here needs your own accounts or decisions, so I can't do it for
you. Work top to bottom; each part says what you'll have at the end. Allow
2–3 hours for parts 1–4. Free plans are enough for staging.

**Never paste passwords, keys or secrets into a chat.** Put them only in
`.env.local` (your computer) or the host's environment settings.

---

## 1. Put the code on GitHub (≈10 min)

You'll have: the code online, so any computer — and Vercel — can get it.

1. Sign in at github.com → **New repository** → name `spot`, **Private**,
   don't add a README.
2. On the computer that has the project now:

   ```bash
   cd ~/Documents/Projects/spot
   git remote add origin https://github.com/<your-name>/spot.git
   git push -u origin main
   ```

## 2. Run Spot on your home computer (≈30 min)

You'll have: Spot running at http://localhost:3000.

1. Install the tools (macOS, with Homebrew):

   ```bash
   brew install node postgresql@17 git
   brew services start postgresql@17
   # PostgreSQL 17's tools (psql) aren't on the PATH by default:
   echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
   ```

   (Windows: install Node.js 22 LTS from nodejs.org, PostgreSQL 17 from
   postgresql.org, and Git from git-scm.com.)

2. Get the code and its packages:

   ```bash
   git clone https://github.com/<your-name>/spot.git
   cd spot
   npm install
   ```

3. Create the databases (`spot` for the app, `spot_test` for tests):

   ```bash
   psql -d postgres \
     -c "CREATE ROLE spot WITH LOGIN PASSWORD 'spot' CREATEDB;" \
     -c "CREATE DATABASE spot OWNER spot;" \
     -c "CREATE DATABASE spot_test OWNER spot;"
   ```

4. Settings: `cp .env.example .env.local`, then open `.env.local` and set
   `AUTH_SECRET` to the output of `openssl rand -base64 32`. The rest can stay
   as it is for now.

5. Create the tables — **one** of:
   - `npm run db:migrate` (simplest), or
   - upload `docs/db/schema.sql` with your SQL tool — see `docs/db/README.md`.

6. Start it: `npm run dev` → open http://localhost:3000.

7. Make yourself the platform admin (after registering at `/register`):

   ```bash
   psql -d spot -c "UPDATE users SET platform_role = 'platform_admin' WHERE email = 'you@example.com';"
   ```

Photo uploads need MinIO locally (README → _Local setup_); everything else
works without it.

## 3. Create the accounts for staging (≈45 min)

You'll have: every value for `.env.production.example`. Copy that file to
somewhere private (not into the project) and fill it in as you go.

| #   | Service                                                          | What to do                                                                                                         | Gives you                                                                                 |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1   | **Database** — Neon (neon.tech, easiest) **or** your GoDaddy VPS | Neon: new project, region **Frankfurt**, Postgres 17. VPS: follow `docs/deploy.md` §2 Option A                     | `DATABASE_URL`                                                                            |
| 2   | **Cloudflare R2** (cloudflare.com)                               | R2 → create bucket `spot-uploads` → turn on public access → create an API token (Object Read & Write, this bucket) | `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `NEXT_PUBLIC_STORAGE_URL` |
| 3   | **Vercel** (vercel.com)                                          | Sign up **with GitHub**. Don't create the project yet — part 4                                                     | —                                                                                         |
| 4   | **Secrets** (your terminal)                                      | Run `openssl rand -base64 32` twice                                                                                | `AUTH_SECRET`, `CRON_SECRET`                                                              |
| 5   | **Ably** (ably.com) — optional                                   | New app → API Keys → copy the root key                                                                             | `ABLY_API_KEY`                                                                            |
| 6   | **Sentry** (sentry.io) — optional                                | New project, platform Next.js → copy the DSN                                                                       | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`                                                    |
| 7   | **Google sign-in** — optional                                    | console.cloud.google.com → Credentials → OAuth client (Web). Redirect URI comes after part 4                       | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                                |

Leave `PAYMENT_PROVIDER` **empty**.

## 4. Put staging online (≈30 min)

You'll have: Spot at `https://<project>.vercel.app`.

Follow `docs/deploy.md` from §6: import the GitHub repo in Vercel, paste the
values from part 3, deploy. The database tables are created automatically
during the first deploy (or upload `docs/db/schema.sql` first — not both).
Then repeat step 7 of part 2 against the staging database to make yourself
admin, and check the list in `docs/deploy.md` §7.

## 5. Decisions only you can make

Each one unblocks a roadmap part. Tell me your choice and I'll build it.

| Decision            | Options                                                                                                                    | Unblocks                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Online payments** | A local bank's card gateway (e.g. Ameriabank vPOS) or Idram. Needs a registered business and a merchant contract with them | Real payments, deposits, paying bills online (Phase 9)                                     |
| **Email sending**   | Resend (simplest, free 3 000/month) or your own SMTP                                                                       | Real reservation emails and review email checks — today they're only saved in the database |
| **First POS**       | iiko, r_keeper or Poster (1C is already supported). Needs API access from the vendor                                       | Phase 14 "First POS integration"                                                           |
| **Domain**          | e.g. `spot.am` — where to buy and which address staging uses                                                               | A real address instead of `*.vercel.app`                                                   |

## 6. When you're done

Just tell me which parts are finished (for example "1–4 done, staging is at
https://…vercel.app") and your decisions from part 5. Don't send any keys or
passwords — I don't need them.
