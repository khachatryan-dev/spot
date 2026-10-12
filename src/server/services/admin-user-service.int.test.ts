import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { auditLogs, restaurants, restaurantStaff, sessions, users } from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import { listUsers, setUserStatus } from "./admin-user-service";

beforeEach(() => truncate(db, ["restaurants", "users", "audit_logs"]));

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

async function person(email: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({ email, ...extra })
    .returning();
  return user!;
}

async function world() {
  const admin = await person("admin@x.am", { name: "Ada", platformRole: "platform_admin" });
  const owner = await person("owner@x.am", { name: "Ani Owner" });
  const guest = await person("guest@x.am", { name: "Gor" });
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: "Cafe", slug: "cafe" })
    .returning();
  await db
    .insert(restaurantStaff)
    .values({ restaurantId: restaurant!.id, userId: owner.id, role: "owner" });
  return { admin, owner, guest };
}

describe("listUsers", () => {
  it("finds people by name or email, with their restaurants and roles", async () => {
    const { admin } = await world();
    const { users: found, total } = await listUsers(admin, { search: "ani" });
    expect(total).toBe(1);
    expect(found[0]).toMatchObject({
      email: "owner@x.am",
      platformRole: "customer",
      status: "active",
      staff: [{ restaurantName: "Cafe", role: "owner", status: "active" }],
    });
    expect((await listUsers(admin, { search: "GUEST@" })).total).toBe(1);
    expect((await listUsers(admin, { search: "%" })).total).toBe(0); // not a wildcard
  });

  it("filters admins, staff and suspended accounts; only admins may look", async () => {
    const { admin, owner, guest } = await world();
    expect((await listUsers(admin, { filter: "admins" })).users.map((u) => u.email)).toEqual([
      "admin@x.am",
    ]);
    expect((await listUsers(admin, { filter: "staff" })).users.map((u) => u.email)).toEqual([
      "owner@x.am",
    ]);
    await setUserStatus(admin, guest.id, { status: "suspended", reason: "Spam reviews" });
    expect((await listUsers(admin, { filter: "suspended" })).users.map((u) => u.email)).toEqual([
      "guest@x.am",
    ]);
    expect(await codeOf(listUsers(owner))).toBe("FORBIDDEN");
  });
});

describe("setUserStatus", () => {
  it("suspends with a reason, signs the person out everywhere, and restores", async () => {
    const { admin, guest } = await world();
    await db.insert(sessions).values({
      userId: guest.id,
      token: "guest-session-token",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(await codeOf(setUserStatus(admin, guest.id, { status: "suspended" }))).toContain(
      "reasonTooShort",
    );
    await setUserStatus(admin, guest.id, { status: "suspended", reason: "Abusive messages" });
    const [suspended] = await db.select().from(users).where(eq(users.id, guest.id));
    expect(suspended).toMatchObject({ status: "suspended", suspensionReason: "Abusive messages" });
    expect(suspended!.suspendedAt).toBeInstanceOf(Date);
    expect(await db.select().from(sessions).where(eq(sessions.userId, guest.id))).toEqual([]);

    await setUserStatus(admin, guest.id, { status: "active" });
    const [restored] = await db.select().from(users).where(eq(users.id, guest.id));
    expect(restored).toMatchObject({ status: "active", suspendedAt: null, suspensionReason: null });
    const actions = (await db.select().from(auditLogs)).map((a) => [a.action, a.metadata]);
    expect(actions).toEqual([
      ["user.suspended", { email: "guest@x.am", reason: "Abusive messages" }],
      ["user.restored", { email: "guest@x.am" }],
    ]);
  });

  it("won't suspend yourself, and two admins can't suspend each other at once", async () => {
    const { admin } = await world();
    expect(
      await codeOf(setUserStatus(admin, admin.id, { status: "suspended", reason: "Testing it" })),
    ).toBe("CONFLICT");
    const second = await person("second@x.am", { platformRole: "platform_admin" });
    const results = await Promise.all([
      codeOf(
        setUserStatus(admin, second.id, { status: "suspended", reason: "Account compromised" }),
      ),
      codeOf(
        setUserStatus(second, admin.id, { status: "suspended", reason: "Account compromised" }),
      ),
    ]);
    // One wins; the platform always keeps an active admin.
    expect(results.sort()).toEqual(["CONFLICT", null].sort());
    const active = await db.select().from(users).where(eq(users.platformRole, "platform_admin"));
    expect(active.filter((u) => u.status === "active")).toHaveLength(1);
  });
});
