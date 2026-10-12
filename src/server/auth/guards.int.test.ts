import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db/client";
import { restaurants, restaurantStaff, users } from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
}));
// Mirror Next's behaviour: redirect() and notFound() throw to stop rendering.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND_PAGE");
  },
}));

const { auth } = await import("./auth");
const { guardPage, requirePlatformPermission, requireRestaurantRole, requireUser } =
  await import("./guards");

const PASSWORD = "correct horse battery";

beforeEach(async () => {
  await truncate(db, ["restaurant_staff", "restaurants", "users", "rate_limits"]);
  requestHeaders = new Headers();
});

/** Create a user, sign them in and make their cookie the current request's. */
async function signInAs(email: string) {
  await auth.api.signUpEmail({ body: { name: email, email, password: PASSWORD } });
  const response = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  });
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  requestHeaders = new Headers({ cookie });
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user!;
}

async function errorOf(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );
}

describe("requireUser", () => {
  it("throws UNAUTHORIZED without a session", async () => {
    expect(await errorOf(requireUser())).toBe("UNAUTHORIZED");
  });

  it("returns the signed-in user", async () => {
    await signInAs("ani@example.am");
    expect((await requireUser()).email).toBe("ani@example.am");
  });
});

describe("requireRestaurantRole", () => {
  it("returns user and access for permitted staff", async () => {
    const ani = await signInAs("ani@example.am");
    const [cafe] = await db.insert(restaurants).values({ name: "Cafe", slug: "cafe" }).returning();
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: cafe!.id, userId: ani.id, role: "owner" });

    const { access } = await requireRestaurantRole(cafe!.id, "staff:manage");
    expect(access.role).toBe("owner");
  });

  it("throws UNAUTHORIZED, NOT_FOUND or FORBIDDEN as appropriate", async () => {
    const [cafe] = await db.insert(restaurants).values({ name: "Cafe", slug: "cafe" }).returning();
    expect(await errorOf(requireRestaurantRole(cafe!.id, "order:read"))).toBe("UNAUTHORIZED");

    const cook = await signInAs("cook@example.am");
    expect(await errorOf(requireRestaurantRole(cafe!.id, "order:read"))).toBe("NOT_FOUND");

    await db
      .insert(restaurantStaff)
      .values({ restaurantId: cafe!.id, userId: cook.id, role: "kitchen" });
    expect(await errorOf(requireRestaurantRole(cafe!.id, "payment:confirm"))).toBe("FORBIDDEN");
  });
});

describe("requirePlatformPermission", () => {
  it("forbids customers and allows platform admins", async () => {
    const ani = await signInAs("ani@example.am");
    expect(await errorOf(requirePlatformPermission("platform:admin:access"))).toBe("FORBIDDEN");

    await db.update(users).set({ platformRole: "platform_admin" }).where(eq(users.id, ani.id));
    expect((await requirePlatformPermission("platform:admin:access")).id).toBe(ani.id);
  });
});

describe("guardPage", () => {
  it("redirects signed-out visitors to the localized login page", async () => {
    expect(await errorOf(guardPage("en", requireUser))).toBe("REDIRECT:/en/login");
    expect(await errorOf(guardPage("hy", requireUser))).toBe("REDIRECT:/login");
  });

  it("shows 404 to signed-in users without access", async () => {
    await signInAs("ani@example.am");
    const guard = () => requirePlatformPermission("platform:admin:access");
    expect(await errorOf(guardPage("hy", guard))).toBe("NOT_FOUND_PAGE");
  });
});
