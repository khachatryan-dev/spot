# Database SQL

`schema.sql` is the whole Spot database — 47 tables, their indexes,
constraints, triggers and functions — as plain SQL for PostgreSQL 15 or
newer (17 recommended). Use it to set up a database by hand (pgAdmin,
DBeaver, TablePlus, `psql`, your host's SQL console).

It also fills the app's migration journal (`drizzle.__drizzle_migrations`),
so when the app starts it knows the database is already up to date and
only applies migrations added later.

## Two ways to create the database — pick one

**A. Let the app do it (simplest).** Create an empty database and point
`DATABASE_URL` at it. `npm run db:migrate` (or the deploy's build step,
`scripts/migrate.mjs`) creates everything.

**B. Upload `schema.sql` yourself.** Useful when you want to see or review
the tables, or your host only gives you an SQL console.

Don't do both on the same database: `schema.sql` expects an **empty** one.

## Loading `schema.sql`

1. Create an empty database and a user that owns it:

   ```sql
   CREATE ROLE spot WITH LOGIN PASSWORD 'choose-a-long-password';
   CREATE DATABASE spot OWNER spot;
   ```

2. Connected **to that database as its owner**, run the file:

   ```bash
   psql "postgresql://spot:PASSWORD@HOST:5432/spot" -v ON_ERROR_STOP=1 -f docs/db/schema.sql
   ```

   In a GUI tool: open `schema.sql` in a query window for the `spot`
   database and run it as a script (all statements, not just the selection).

3. Check it worked:

   ```sql
   SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';  -- 47
   SELECT count(*) FROM drizzle.__drizzle_migrations;                             -- 37
   ```

The file turns on two standard extensions, `btree_gist` (no double
bookings) and `pg_trgm` (restaurant search). They're "trusted", so the
database owner can enable them on PostgreSQL 13+; on managed hosts (Neon,
Supabase, DigitalOcean, AWS RDS) they're allowed. If your host refuses, ask
an administrator to run `CREATE EXTENSION btree_gist; CREATE EXTENSION
pg_trgm;` first.

## Demo database (`demo-database.sql`)

For showing Spot to people, load `demo-database.sql` **instead of**
`schema.sql` into an empty database (same steps as above). It is the full
schema plus a month of demo life:

- 10 restaurants in Yerevan, Gyumri, Dilijan and Sevan — menus in Armenian
  and English (106 dishes, some with options), 8 tables each with working
  QR codes, opening hours, bookings on most of them;
- 10 guests with favourites, ~55 paid table visits, bookings (completed,
  no-show, cancelled, upcoming, waiting for confirmation), guest reviews
  with owner replies, restaurants' ratings of guests, one reported review,
  contact messages and notifications.

Every demo login uses the password **`demo1234`**:

| Who               | Email                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform admin    | `admin@demo.spot.am`                                                                                                                                            |
| Restaurant owners | `owner.<key>@demo.spot.am` — keys: `ararat`, `tbilisi`, `napoli`, `sakura`, `lavash-cafe`, `dilijan-forest`, `burger-lab`, `beirut`, `sevan-fish`, `green-bowl` |
| Ararat's team     | `waiter.ararat@…`, `kitchen.ararat@…`, `cashier.ararat@…`                                                                                                       |
| Guests            | `anna`, `aram`, `mariam`, `davit`, `lilit`, `narek`, `sona`, `tigran`, `emma`, `lucas` `@demo.spot.am`                                                          |

Never use the demo database for real customers: the password is public and
the QR codes are in this repository. Rebuild the file after a schema change
with `npm run db:export-demo`; or seed an empty database you already
migrated with `npm run db:seed-demo` (it refuses to touch a database that
has real users).

## After a schema change

Developers: after adding a migration, rebuild the file so it stays in step
with `drizzle/`:

```bash
npm run db:export-schema
```

It migrates a temporary empty database and dumps it (needs a local role that
can create databases; set `ADMIN_URL` if yours isn't `spot:spot@localhost`).
To update a database you already loaded, don't re-run `schema.sql` — run
`npm run db:migrate`, which applies only the new migrations.

## What's in it

| Area                  | Tables                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts              | `users`, `accounts`, `sessions`, `verifications`, `guests`, `favorites`                                                                                       |
| Restaurants           | `restaurants`, `restaurant_locations`, `restaurant_staff`, `staff_invitations`, `tables`, `qr_tokens`                                                         |
| Menu                  | `menus`, `menu_locations`, `menu_categories`, `menu_items`, `modifier_groups`, `modifiers`                                                                    |
| Table visits & orders | `table_sessions`, `table_session_members`, `table_requests`, `orders`, `order_items`, `order_item_modifiers`, `order_status_history`, `order_number_counters` |
| Reservations          | `reservations`, `reservation_holds`                                                                                                                           |
| Bills & payments      | `bills`, `bill_items`, `bill_payments`, `bill_payment_items`, `payments`, `payment_events`, `payment_refunds`                                                 |
| Reviews               | `reviews`                                                                                                                                                     |
| Notifications         | `notifications`, `email_messages`                                                                                                                             |
| POS / 1C              | `pos_connections`, `pos_outbox`, `pos_external_refs`, `pos_catalog_snapshots`                                                                                 |
| Platform              | `audit_logs`, `analytics_events`, `rate_limits`                                                                                                               |

Money columns ending in `_minor` are integers in the smallest unit
(AMD: 100 = 1 ֏). Times are `timestamp with time zone` (stored in UTC).
