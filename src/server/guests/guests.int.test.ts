import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db/client";
import { guests } from "@/server/db/schema";
import { truncate } from "@/test/db";

// Minimal stand-in for next/headers so cookie helpers and auth hooks can run.
const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
let requestHeaders = new Headers();
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) =>
      jar.set(name, { value, options }),
    getAll: () => [...jar].map(([name, { value }]) => ({ name, value })),
  }),
}));

const { claimGuest, createGuest, findGuestByToken, GUEST_TTL_MS } = await import("./guest-service");
const { ensureGuest, getCustomer } = await import("./current-customer");
const { GUEST_COOKIE } = await import("./guest-cookie");
const { auth } = await import("@/server/auth/auth");

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await truncate(db, ["guests", "users", "rate_limits"]);
  jar.clear();
  requestHeaders = new Headers();
});

describe("guest tokens", () => {
  it("are random and stored only as a SHA-256 hash", async () => {
    const a = await createGuest();
    const b = await createGuest();

    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43); // 32 bytes, base64url
    const rows = await db.select().from(guests);
    expect(JSON.stringify(rows)).not.toContain(a.token);
    expect(rows.map((r) => r.tokenHash)).toContain(
      createHash("sha256").update(a.token).digest("hex"),
    );
  });

  it("resolve to the guest, and unknown tokens resolve to null", async () => {
    const { guest, token } = await createGuest();
    expect((await findGuestByToken(token))?.id).toBe(guest.id);
    expect(await findGuestByToken("not-a-real-token")).toBeNull();
    expect(await findGuestByToken(undefined)).toBeNull();
  });

  it("stop working after 30 days of inactivity", async () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const { token } = await createGuest(created);
    const later = new Date(created.getTime() + GUEST_TTL_MS + 1);
    expect(await findGuestByToken(token, later)).toBeNull();
  });

  it("extend their expiry while in use, at most once a day", async () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const { guest, token } = await createGuest(created);

    const sameDay = await findGuestByToken(token, new Date(created.getTime() + DAY / 2));
    expect(sameDay?.expiresAt).toEqual(guest.expiresAt);

    const nextWeek = new Date(created.getTime() + 7 * DAY);
    const touched = await findGuestByToken(token, nextWeek);
    expect(touched?.expiresAt.getTime()).toBe(nextWeek.getTime() + GUEST_TTL_MS);
  });
});

describe("claiming", () => {
  async function createUser(email = "ani@example.am") {
    const { user } = await auth.api.signUpEmail({
      body: { name: "Ani", email, password: "correct horse battery" },
    });
    return user;
  }

  it("links a guest to a user only once, then disables its token", async () => {
    const { guest, token } = await createGuest();
    const ani = await createUser();
    const other = await createUser("other@example.am");

    expect(await claimGuest(guest.id, ani.id)).not.toBeNull();
    expect(await claimGuest(guest.id, other.id)).toBeNull();
    expect(await findGuestByToken(token)).toBeNull();

    const [row] = await db.select().from(guests);
    expect(row?.claimedByUserId).toBe(ani.id);
  });

  it("happens automatically when a guest signs in", async () => {
    await createUser();
    const { guest, token } = await createGuest();

    await auth.api.signInEmail({
      body: { email: "ani@example.am", password: "correct horse battery" },
      headers: new Headers({ cookie: `${GUEST_COOKIE}=${token}` }),
    });

    const [row] = await db.select().from(guests);
    expect(row?.id).toBe(guest.id);
    expect(row?.claimedByUserId).not.toBeNull();
  });
});

describe("ensureGuest / getCustomer", () => {
  it("creates a guest with a secure httpOnly cookie on first visit", async () => {
    expect(await getCustomer()).toBeNull();

    const guest = await ensureGuest();
    const cookie = jar.get(GUEST_COOKIE);
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect((await findGuestByToken(cookie?.value))?.id).toBe(guest.id);
  });

  it("reuses the existing guest instead of creating another", async () => {
    const first = await ensureGuest();
    const second = await ensureGuest();
    expect(second.id).toBe(first.id);
    expect(await db.select().from(guests)).toHaveLength(1);
  });
});
