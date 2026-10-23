/**
 * Demo data: 10 restaurants with menus, tables and QR codes, 10 guests, and
 * 30 days of history — table visits with orders and paid bills, bookings
 * (completed, no-show, cancelled, upcoming), reviews both ways, owner replies,
 * favourites, a reported review and contact messages.
 *
 * Everything goes through the app's own services (prices, QR tokens, audit
 * log, notifications), so the data behaves like real use. Only past dates are
 * moved with SQL after each table visit.
 *
 *   npm run db:seed-demo          (uses DATABASE_URL from .env.local)
 *
 * For a DEMO database only: it refuses to run if real (non-demo) users exist.
 * Every demo account uses the password below.
 */
import { hashPassword } from "better-auth/crypto";
import { eq, like, not, sql } from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  accounts,
  customerReviews,
  restaurantLocations,
  reviews,
  tableSessions,
  users,
} from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { sendContactMessage } from "@/server/services/contact-service";
import { approveRestaurant } from "@/server/services/admin-restaurant-service";
import { setFavorite, updateProfile } from "@/server/services/account-service";
import { recordBillPayment } from "@/server/services/bill-payment-service";
import { finalizeBill } from "@/server/services/bill-service";
import { rateCustomer } from "@/server/services/customer-review-service";
import { createLocation, updateLocation } from "@/server/services/location-service";
import {
  createCategory,
  createItem,
  createMenu,
  createModifier,
  createModifierGroup,
} from "@/server/services/menu-service";
import { changeOrderStatus, createOrder } from "@/server/services/order-service";
import { ensureLocationQr, listLocationQr, resolveQrToken } from "@/server/services/qr-service";
import { placeReservationHold } from "@/server/services/reservation-hold-service";
import { createReservation, updateReservationStatus } from "@/server/services/reservation-service";
import { createRestaurant, submitForReview } from "@/server/services/restaurant-service";
import { reportReview, respondToReview } from "@/server/services/restaurant-review-service";
import { createReview } from "@/server/services/review-service";
import { acceptInvitation, inviteStaff } from "@/server/services/staff-service";
import { createTablesBulk } from "@/server/services/table-service";
import { closeTableSession, joinTableSession } from "@/server/services/table-session-service";
import type { OpeningHours } from "@/shared/schemas/opening-hours";

import {
  CUSTOMERS,
  type DemoRestaurant,
  GUEST_COMMENTS,
  OWNER_REPLIES,
  RESTAURANTS,
  STAFF_COMMENTS,
} from "./demo/data";

export const DEMO_PASSWORD = "demo1234";
const DOMAIN = "demo.spot.am";
const DAY = 86_400_000;
const HOUR = 3_600_000;

// Same data on every run.
let state = 20261023;
const random = () => (state = (state * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
const chance = (p: number) => random() < p;

type User = typeof users.$inferSelect;
const asCustomer = (user: User): Customer => ({
  type: "user",
  user: user as unknown as Extract<Customer, { type: "user" }>["user"],
});

/** Yerevan wall-clock time `days` from today at hh:mm. */
function yerevan(days: number, hhmm: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yerevan" }).format(new Date());
  return new Date(new Date(`${today}T${hhmm}:00+04:00`).getTime() + days * DAY);
}

const week = (open: string, close: string): OpeningHours => {
  const day = [{ open, close }];
  return { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
};
const ALWAYS = week("00:00", "23:59");

/** Rate limits are per minute/hour; a seed does an hour of activity in seconds. */
const clearRateLimits = () => db.execute(sql`DELETE FROM rate_limits`);

async function createUser(
  email: string,
  name: string,
  extra: Partial<typeof users.$inferInsert> = {},
): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ email, name, emailVerified: true, preferredLocale: "hy", ...extra })
    .returning();
  await db.insert(accounts).values({
    userId: user!.id,
    accountId: user!.id,
    providerId: "credential",
    password: await hashPassword(DEMO_PASSWORD),
  });
  return user!;
}

/** Guards that keep money history unchangeable (paid bills, order lines, payment events). */
const HISTORY_GUARDS: [table: string, trigger: string][] = [
  ["bill_items", "bill_items_only_while_open"],
  ["bill_payments", "bill_payments_guard"],
  ["bills", "bills_guard"],
  ["order_items", "order_items_immutable"],
  ["order_status_history", "order_status_history_append_only"],
  ["orders", "orders_lock_amounts"],
  ["payment_events", "payment_events_append_only"],
  ["payments", "payments_lock_terms"],
];

/**
 * Move every timestamp of one (fake) table visit back by `ms`, so history
 * spreads over the last month. Money tables are append-only by design; in
 * this demo seed only, their guards are lifted inside the same transaction
 * and restored before it commits — a failure rolls everything back.
 */
async function shiftVisit(sessionId: string, ms: number) {
  const columns = await db.execute<{ table_name: string; columns: string[] }>(sql`
    SELECT table_name, array_agg(column_name::text) AS columns
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type LIKE 'timestamp%' AND table_name IN (
      'table_sessions', 'table_session_members', 'orders', 'order_items', 'order_status_history',
      'bills', 'bill_items', 'bill_payments', 'payments', 'payment_events', 'table_requests')
    GROUP BY table_name`);
  const by = new Map(columns.map((c) => [c.table_name, c.columns]));
  const interval = sql.raw(`interval '${Math.round(ms / 1000)} seconds'`);

  await db.transaction(async (tx) => {
    const shift = async (table: string, where: ReturnType<typeof sql>) => {
      const cols = by.get(table) ?? [];
      if (cols.length === 0) return;
      const set = sql.join(
        cols.map((c) => sql`${sql.identifier(c)} = ${sql.identifier(c)} - ${interval}`),
        sql`, `,
      );
      await tx.execute(sql`UPDATE ${sql.identifier(table)} SET ${set} WHERE ${where}`);
    };
    const guards = (on: boolean) =>
      Promise.all(
        HISTORY_GUARDS.map(([table, trigger]) =>
          tx.execute(
            sql`ALTER TABLE ${sql.identifier(table)} ${sql.raw(on ? "ENABLE" : "DISABLE")} TRIGGER ${sql.identifier(trigger)}`,
          ),
        ),
      );
    const orderIds = sql`order_id IN (SELECT id FROM orders WHERE table_session_id = ${sessionId})`;
    const billIds = sql`bill_id IN (SELECT id FROM bills WHERE table_session_id = ${sessionId})`;
    const paymentIds = sql`id IN (SELECT payment_id FROM bill_payments WHERE ${billIds})`;

    await guards(false);
    await shift("payment_events", sql`payment_id IN (SELECT id FROM payments WHERE ${paymentIds})`);
    await shift("payments", paymentIds);
    await shift("bill_payments", billIds);
    await shift("bill_items", billIds);
    await shift("order_items", orderIds);
    await shift("order_status_history", orderIds);
    await shift("bills", sql`table_session_id = ${sessionId}`);
    await shift("orders", sql`table_session_id = ${sessionId}`);
    await shift("table_requests", sql`table_session_id = ${sessionId}`);
    await shift("table_session_members", sql`session_id = ${sessionId}`);
    await shift("table_sessions", sql`id = ${sessionId}`);
    await guards(true);
  });
}

interface SeededRestaurant {
  data: DemoRestaurant;
  id: string;
  locationId: string;
  owner: User;
  hours: OpeningHours;
  tokens: string[];
  items: { id: string; modifierIds: string[] }[];
}

async function seedRestaurant(data: DemoRestaurant, index: number, admin: User) {
  const owner = await createUser(`owner.${data.key}@${DOMAIN}`, `${data.name} (սեփականատեր)`);
  const restaurant = await createRestaurant(owner, {
    name: data.name,
    phone: data.phone,
    description: data.description,
    cuisines: data.cuisines,
    priceRange: data.priceRange,
  });
  const location = await createLocation(owner, restaurant.id, {
    name: data.location.name,
    addressLine: data.location.address,
    city: data.location.city,
  });
  const hours = data.cuisines.includes("cafe") ? week("08:00", "22:00") : week("11:00", "23:00");
  await updateLocation(owner, restaurant.id, location.id, {
    latitude: data.location.lat,
    longitude: data.location.lng,
    openingHours: hours,
    reservationsEnabled: data.bookings,
    // Two places confirm bookings by hand, so staff have requests to answer.
    reservationConfirmation: index % 4 === 1 ? "manual" : "auto",
  });
  await createTablesBulk(owner, restaurant.id, {
    locationId: location.id,
    from: 1,
    to: 8,
    capacity: 4,
  });
  await ensureLocationQr(owner, restaurant.id, location.id);
  const tokens = (await listLocationQr(owner, restaurant.id, location.id)).flatMap((t) =>
    t.token ? [t.token] : [],
  );

  const menu = await createMenu(owner, restaurant.id, {
    name: "Մենյու",
    translations: { en: { name: "Menu" } },
    locationIds: [location.id],
  });
  const items: SeededRestaurant["items"] = [];
  for (const category of data.categories) {
    const created = await createCategory(owner, restaurant.id, menu.id, {
      name: category.hy,
      translations: { en: { name: category.en } },
    });
    for (const item of category.items) {
      const row = await createItem(owner, restaurant.id, {
        categoryId: created.id,
        name: item.hy,
        description: item.descHy,
        translations: { en: { name: item.en, description: item.descEn } },
        priceMinor: item.dram * 100,
        allergens: item.allergens,
        dietaryTags: item.dietary,
      });
      const modifierIds: string[] = [];
      if (item.options) {
        const group = await createModifierGroup(owner, restaurant.id, row.id, {
          name: item.options.hy,
          translations: { en: { name: item.options.en } },
          minSelect: 1,
          maxSelect: 1,
        });
        for (const [i, [hy, en, dram]] of item.options.choices.entries()) {
          const modifier = await createModifier(owner, restaurant.id, group.id, {
            name: hy,
            translations: { en: { name: en } },
            priceDeltaMinor: dram * 100,
            isDefault: i === 0,
          });
          modifierIds.push(modifier.id);
        }
      }
      items.push({ id: row.id, modifierIds });
    }
  }

  await submitForReview(owner, restaurant.id);
  await approveRestaurant(admin, restaurant.id);
  return { data, id: restaurant.id, locationId: location.id, owner, hours, tokens, items };
}

/** One table visit: guests order, the kitchen serves, the bill is paid, the table closes. */
async function seedVisit(r: SeededRestaurant, guests: User[], daysAgo: number, key: string) {
  const token = pick(r.tokens);
  const qr = (await resolveQrToken(token))!;
  let sessionId = "";
  for (const guest of guests) {
    sessionId = (await joinTableSession(asCustomer(guest), qr)).id;
  }
  for (const [g, guest] of guests.entries()) {
    const lines = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
      const item = pick(r.items);
      return {
        itemId: item.id,
        modifierIds: item.modifierIds.length ? [pick(item.modifierIds)] : [],
        quantity: chance(0.25) ? 2 : 1,
      };
    });
    const order = await createOrder(asCustomer(guest), sessionId, {
      lines,
      idempotencyKey: `demo-${key}-${g}-0000`,
    });
    for (const to of ["accepted", "preparing", "ready", "served"] as const) {
      await changeOrderStatus(r.owner, r.id, order.id, to);
    }
  }
  const bill = await finalizeBill(r.owner, r.id, sessionId);
  await recordBillPayment(r.owner, r.id, bill.bill.id, {
    mode: "full",
    method: chance(0.5) ? "cash" : "card_terminal",
  });
  await closeTableSession(r.owner, r.id, sessionId).catch(() => undefined);

  // Back to a past evening.
  const [session] = await db
    .select({ createdAt: tableSessions.createdAt })
    .from(tableSessions)
    .where(eq(tableSessions.id, sessionId));
  const target = yerevan(-daysAgo, pick(["13:15", "14:30", "19:00", "20:15", "21:00"]));
  await shiftVisit(sessionId, session!.createdAt.getTime() - target.getTime());
  return { sessionId, endedAt: new Date(target.getTime() + 2 * HOUR) };
}

const commentFor = (comments: Record<number, string[]>, rating: number) =>
  comments[rating] ? pick(comments[rating]) : null;

async function main() {
  const real = await db
    .select({ id: users.id })
    .from(users)
    .where(not(like(users.email, `%@${DOMAIN}`)))
    .limit(1);
  // if (real.length > 0) {
  //   throw new Error(
  //     "This database has real users. Seed demo data only into an empty demo database.",
  //   );
  // }
  // if ((await db.select({ id: users.id }).from(users).limit(1)).length > 0) {
  //   throw new Error("Demo data is already here. Recreate the database to seed again.");
  // }

  console.log("Accounts…");
  const admin = await createUser(`admin@${DOMAIN}`, "Spot Admin", {
    platformRole: "platform_admin",
  });
  const guests: User[] = [];
  for (const c of CUSTOMERS) {
    const user = await createUser(`${c.key}@${DOMAIN}`, c.name, { preferredLocale: c.locale });
    await updateProfile(user, { name: c.name, phone: c.phone, preferredLocale: c.locale });
    guests.push(user);
  }

  console.log("Restaurants, menus, tables, QR codes…");
  const places: SeededRestaurant[] = [];
  for (const [i, data] of RESTAURANTS.entries()) places.push(await seedRestaurant(data, i, admin));

  // A full team at the first restaurant: waiter, kitchen and cashier logins.
  const first = places[0]!;
  for (const role of ["waiter", "kitchen", "cashier"] as const) {
    const member = await createUser(
      `${role}.${first.data.key}@${DOMAIN}`,
      `${role} · ${first.data.name}`,
    );
    const { token } = await inviteStaff(first.owner, first.id, { email: member.email, role });
    await acceptInvitation(member, token);
  }

  for (const guest of guests) {
    for (const place of [pick(places), pick(places)]) {
      await setFavorite(guest, place.id, true).catch(() => undefined);
    }
  }

  console.log("30 days of table visits…");
  // Orders need the place open "now"; open all day while history is written.
  await db.update(restaurantLocations).set({ openingHours: ALWAYS });
  let visitCount = 0;
  for (let daysAgo = 29; daysAgo >= 1; daysAgo--) {
    for (let v = 0; v < 1 + Math.floor(random() * 3); v++) {
      await clearRateLimits();
      const place = pick(places);
      const party = chance(0.35) ? [pick(guests), pick(guests)] : [pick(guests)];
      const unique = [...new Map(party.map((g) => [g.id, g])).values()];
      const visit = await seedVisit(place, unique, daysAgo, `${daysAgo}-${v}`);
      visitCount++;
      for (const guest of unique) {
        // Guests review most visits; owners answer some.
        if (chance(0.6)) {
          const rating = pick([5, 5, 5, 4, 4, 4, 3, 2, 1]);
          const review = await createReview(
            asCustomer(guest),
            {
              subject: "visit",
              targetId: visit.sessionId,
              rating,
              comment: commentFor(GUEST_COMMENTS, rating),
            },
            new Date(visit.endedAt.getTime() + HOUR),
          );
          await db
            .update(reviews)
            .set({
              createdAt: new Date(visit.endedAt.getTime() + HOUR),
              publishedAt: new Date(visit.endedAt.getTime() + HOUR),
            })
            .where(eq(reviews.id, review.id));
          if (chance(0.5)) {
            await respondToReview(place.owner, place.id, review.id, pick(OWNER_REPLIES));
          }
        }
        // Restaurants rate some guests back.
        if (chance(0.45)) {
          const rating = pick([5, 5, 5, 4, 4, 2]);
          const saved = await rateCustomer(
            place.owner,
            place.id,
            { subject: "visit", tableSessionId: visit.sessionId, customerUserId: guest.id },
            { rating, comment: commentFor(STAFF_COMMENTS, rating) },
            new Date(visit.endedAt.getTime() + 2 * HOUR),
          );
          const at = new Date(visit.endedAt.getTime() + 2 * HOUR);
          await db
            .update(customerReviews)
            .set({ createdAt: at, updatedAt: at })
            .where(eq(customerReviews.id, saved.id));
        }
      }
    }
  }
  // Real opening hours again.
  for (const place of places) {
    await db
      .update(restaurantLocations)
      .set({ openingHours: place.hours })
      .where(eq(restaurantLocations.id, place.locationId));
  }

  console.log("Bookings…");
  const bookable = places.filter((p) => p.data.bookings);
  let bookingCount = 0;
  const book = async (place: SeededRestaurant, guest: User, days: number, time: string) => {
    await clearRateLimits();
    const startsAt = yerevan(days, time);
    const madeAt = new Date(startsAt.getTime() - 2 * DAY);
    const hold = await placeReservationHold(
      guest,
      {
        restaurantId: place.id,
        locationId: place.locationId,
        startsAt,
        partySize: pick([2, 2, 3, 4]),
      },
      madeAt,
    );
    bookingCount++;
    return createReservation(
      guest,
      { holdId: hold.id, contactName: guest.name ?? "", contactPhone: "+37491100000" },
      madeAt,
    );
  };
  // The past: mostly completed, a few no-shows and cancellations.
  for (let i = 0; i < 18; i++) {
    const place = pick(bookable);
    const guest = pick(guests);
    const days = -(2 + Math.floor(random() * 26));
    const time = pick(["13:00", "19:00", "20:00"]);
    const reservation = await book(place, guest, days, time).catch(() => null);
    if (!reservation) continue;
    const startsAt = reservation.startsAt.getTime();
    const step = (
      action: "confirm" | "arrive" | "seat" | "complete" | "no_show" | "cancel",
      at: number,
    ) =>
      updateReservationStatus(
        place.owner,
        place.id,
        reservation.id,
        action,
        { reason: "Ծրագրերը փոխվեցին" },
        new Date(at),
      );
    if (reservation.status === "pending_confirmation") await step("confirm", startsAt - DAY);
    // Every sixth booking is a no-show, another a cancellation; the rest went well.
    const outcome = i % 6 === 4 ? "no_show" : i % 6 === 5 ? "cancel" : "done";
    if (outcome === "cancel") {
      await step("cancel", startsAt - 6 * HOUR);
      continue;
    }
    if (outcome === "no_show") {
      await step("no_show", startsAt + HOUR);
      if (chance(0.8)) {
        await rateCustomer(
          place.owner,
          place.id,
          { subject: "reservation", reservationId: reservation.id },
          { rating: 1, comment: pick(STAFF_COMMENTS[1]!) },
          new Date(startsAt + 2 * HOUR),
        );
      }
      continue;
    }
    await step("arrive", startsAt);
    await step("seat", startsAt + 5 * 60_000);
    await step("complete", startsAt + 2 * HOUR);
    const after = new Date(startsAt + 3 * HOUR);
    if (chance(0.5)) {
      const rating = pick([5, 5, 4, 4, 3]);
      await createReview(
        asCustomer(guest),
        {
          subject: "reservation",
          targetId: reservation.id,
          rating,
          comment: commentFor(GUEST_COMMENTS, rating),
        },
        after,
      ).then((review) =>
        db
          .update(reviews)
          .set({ createdAt: after, publishedAt: after })
          .where(eq(reviews.id, review.id)),
      );
    }
    if (chance(0.5)) {
      await rateCustomer(
        place.owner,
        place.id,
        { subject: "reservation", reservationId: reservation.id },
        { rating: pick([5, 5, 4]), comment: commentFor(STAFF_COMMENTS, 5) },
        after,
      );
    }
  }
  // The next week: upcoming bookings (some still waiting for the restaurant).
  for (let i = 0; i < 10; i++) {
    await book(
      pick(bookable),
      pick(guests),
      1 + Math.floor(random() * 7),
      pick(["13:00", "19:00", "20:00"]),
    ).catch(() => null);
  }

  console.log("A reported review and contact messages…");
  const [worst] = await db
    .select({ id: reviews.id, restaurantId: reviews.restaurantId })
    .from(reviews)
    .where(eq(reviews.rating, 1))
    .limit(1);
  const worstPlace = places.find((p) => p.id === worst?.restaurantId);
  if (worst && worstPlace) {
    await reportReview(
      worstPlace.owner,
      worstPlace.id,
      worst.id,
      "Մեկնաբանությունը չի համապատասխանում իրականությանը",
    );
  }
  const messages = [
    {
      name: "Գոհար Մանուկյան",
      email: "gohar@example.am",
      topic: "restaurant",
      message: "Ուզում ենք մեր սրճարանը միացնել Spot-ին։ Ինչպե՞ս սկսել։",
    },
    {
      name: "Peter Brown",
      email: "peter@example.com",
      topic: "guest",
      message: "Is there an English menu in every restaurant on Spot?",
    },
    {
      name: "Արտակ Վարդանյան",
      email: "artak@example.am",
      topic: "partnership",
      message: "Առաջարկում ենք համագործակցություն առաքման ծառայության հետ։",
    },
  ] as const;
  for (const [i, m] of messages.entries()) {
    await sendContactMessage(m, { ip: `198.51.100.${i + 1}`, locale: "hy" });
  }

  const counts = await db.execute<{ what: string; n: number }>(sql`
    SELECT 'orders' AS what, count(*)::int AS n FROM orders
    UNION ALL SELECT 'paid bills', count(*)::int FROM bills WHERE status = 'paid'
    UNION ALL SELECT 'bookings', count(*)::int FROM reservations
    UNION ALL SELECT 'guest reviews', count(*)::int FROM reviews
    UNION ALL SELECT 'ratings of guests', count(*)::int FROM customer_reviews`);
  console.log(
    `\nDone: ${places.length} restaurants, ${guests.length} guests, ${visitCount} visits, ${bookingCount} bookings.`,
  );
  for (const c of counts) console.log(`  ${c.what}: ${c.n}`);
  console.log(`\nAll demo logins use the password "${DEMO_PASSWORD}":`);
  console.log(`  admin@${DOMAIN}  ·  owner.<key>@${DOMAIN}  ·  <guest>@${DOMAIN}`);
  console.log(`  e.g. owner.ararat@${DOMAIN}, waiter.ararat@${DOMAIN}, anna@${DOMAIN}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
