import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { restaurantLocations, restaurants, users } from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { orderingSetup } from "@/test/ordering-fixtures";

import {
  getProfile,
  isFavorite,
  listFavorites,
  getVisitSummary,
  listMyVisits,
  setFavorite,
  updateProfile,
} from "./account-service";
import { cancelOrderAsCustomer, createOrder } from "./order-service";
import { resolveQrToken } from "./qr-service";
import { joinTableSession } from "./table-session-service";

beforeEach(() => truncate(db, ["restaurants", "users", "guests", "rate_limits"]));

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

async function account(email: string) {
  const [user] = await db.insert(users).values({ email, name: "Anna" }).returning();
  return user!;
}

const asCustomer = (user: Awaited<ReturnType<typeof account>>): Customer => ({
  type: "user",
  user: user as unknown as Extract<Customer, { type: "user" }>["user"],
});

describe("profile", () => {
  it("saves name, phone (normalized) and language", async () => {
    const anna = await account("anna@x.am");
    await updateProfile(anna, {
      name: " Anna K. ",
      phone: "+374 91 12-34-56",
      preferredLocale: "en",
    });
    expect(await getProfile(anna)).toEqual({
      name: "Anna K.",
      email: "anna@x.am",
      phone: "+37491123456",
      preferredLocale: "en",
    });
    await updateProfile(anna, { name: "Anna", phone: "", preferredLocale: "hy" });
    expect((await getProfile(anna)).phone).toBeNull();
  });

  it("refuses another account's phone and bad values", async () => {
    const anna = await account("anna@x.am");
    const ben = await account("ben@x.am");
    await updateProfile(anna, { name: "Anna", phone: "+37491123456", preferredLocale: "hy" });
    expect(
      await codeOf(
        updateProfile(ben, { name: "Ben", phone: "+374 91 123456", preferredLocale: "hy" }),
      ),
    ).toBe("CONFLICT");
    for (const bad of [
      { name: "B", phone: "", preferredLocale: "hy" },
      { name: "Ben", phone: "call me", preferredLocale: "hy" },
      { name: "Ben", phone: "", preferredLocale: "fr" },
    ]) {
      expect(await codeOf(updateProfile(ben, bad as never))).not.toBeNull();
    }
  });
});

describe("favorites", () => {
  async function restaurant(slug: string, status: "active" | "draft" = "active") {
    const [row] = await db.insert(restaurants).values({ name: slug, slug, status }).returning();
    await db.insert(restaurantLocations).values({
      restaurantId: row!.id,
      name: "Main",
      slug: "main",
      addressLine: "1 St",
      city: "Yerevan",
      reservationsEnabled: true,
    });
    return row!;
  }

  it("saves public restaurants once, lists them with a booking link, and unsaves", async () => {
    const anna = await account("anna@x.am");
    const cafe = await restaurant("cafe");
    await setFavorite(anna, cafe.id, true);
    await setFavorite(anna, cafe.id, true);
    expect(await isFavorite(anna, cafe.id)).toBe(true);
    expect(await listFavorites(anna)).toEqual([
      { restaurantId: cafe.id, name: "cafe", slug: "cafe", bookingLocationSlug: "main" },
    ]);
    await setFavorite(anna, cafe.id, false);
    expect(await listFavorites(anna)).toEqual([]);
  });

  it("can't save restaurants that aren't public, and drops ones that stop being public", async () => {
    const anna = await account("anna@x.am");
    const draft = await restaurant("draft", "draft");
    expect(await codeOf(setFavorite(anna, draft.id, true))).toBe("NOT_FOUND");
    const cafe = await restaurant("cafe");
    await setFavorite(anna, cafe.id, true);
    await db.update(restaurants).set({ status: "suspended" }).where(eq(restaurants.id, cafe.id));
    expect(await listFavorites(anna)).toEqual([]);
  });
});

describe("visit history", () => {
  it("lists visits where the guest ordered, with what they spent (not cancelled)", async () => {
    const s = await orderingSetup();
    const anna = await account("anna@x.am");
    const me = asCustomer(anna);
    await joinTableSession(me, (await resolveQrToken(s.token))!);
    await createOrder(me, s.session.id, {
      lines: [{ itemId: s.soup.id, quantity: 2 }],
      idempotencyKey: "anna-order-1",
    });
    const cancelled = await createOrder(me, s.session.id, {
      lines: [{ itemId: s.soup.id, quantity: 1 }],
      idempotencyKey: "anna-order-2",
    });
    await cancelOrderAsCustomer(me, s.session.id, cancelled.id);
    // Someone else at the table doesn't count towards Anna's spending.
    await createOrder(s.ani, s.session.id, {
      lines: [{ itemId: s.soup.id, quantity: 5 }],
      idempotencyKey: "ani-order-1",
    });

    expect(await listMyVisits(anna)).toMatchObject([
      {
        sessionId: s.session.id,
        restaurantName: "Order Cafe",
        locationName: "Main",
        orderCount: 1,
        spentMinor: 400_000,
        currency: "AMD",
        restaurantPublic: true,
      },
    ]);
    expect(await listMyVisits(await account("ben@x.am"))).toEqual([]);

    expect(await getVisitSummary(anna)).toEqual({
      visits: 1,
      spent: [{ currency: "AMD", minor: 400_000 }],
    });
    expect(await getVisitSummary(await account("ben2@x.am"))).toEqual({ visits: 0, spent: [] });
  });
});
