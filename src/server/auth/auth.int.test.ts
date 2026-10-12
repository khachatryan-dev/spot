import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db/client";
import { accounts, sessions, users } from "@/server/db/schema";
import { truncate } from "@/test/db";

// getSession() reads request headers via next/headers; feed it per test.
let requestHeaders = new Headers();
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
}));

const { auth } = await import("./auth");
const { getSession } = await import("./session");

const PASSWORD = "correct horse battery";

beforeEach(async () => {
  await truncate(db, ["users", "verifications", "rate_limits"]);
  requestHeaders = new Headers();
});

async function signUp(email = "ani@example.am", body: Record<string, unknown> = {}) {
  return auth.api.signUpEmail({ body: { name: "Ani", email, password: PASSWORD, ...body } });
}

/** Sign in and return the Cookie header a browser would send back. */
async function signIn(email = "ani@example.am", password = PASSWORD) {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { response, cookie };
}

describe("sign up", () => {
  it("creates a lowercase-email customer with a hashed password", async () => {
    await signUp("Ani@Example.AM");

    const [user] = await db.select().from(users);
    expect(user).toMatchObject({ email: "ani@example.am", platformRole: "customer" });

    const [account] = await db.select().from(accounts).where(eq(accounts.userId, user!.id));
    expect(account?.providerId).toBe("credential");
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain(PASSWORD);
  });

  it("never lets the client choose its role or status", async () => {
    await signUp("ani@example.am", { platformRole: "platform_admin", status: "active" }).catch(
      () => null,
    );
    const rows = await db.select().from(users);
    expect(rows.every((u) => u.platformRole === "customer")).toBe(true);
  });

  it("rejects short passwords", async () => {
    await expect(signUp("ani@example.am", { password: "short" })).rejects.toThrow();
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("rejects a second account with the same email", async () => {
    await signUp();
    await expect(signUp("ANI@example.am")).rejects.toThrow();
  });
});

describe("sign in and sessions", () => {
  beforeEach(() => signUp());

  it("rejects a wrong password", async () => {
    const { response } = await signIn("ani@example.am", "wrong password!");
    expect(response.status).toBe(401);
  });

  it("creates a database session and records the login time", async () => {
    const { response, cookie } = await signIn();
    expect(response.status).toBe(200);
    expect(cookie).toContain("spot.session_token=");

    const [user] = await db.select().from(users);
    expect(user?.lastLoginAt).toBeInstanceOf(Date);
    expect(await db.select().from(sessions)).toHaveLength(2); // sign-up auto sign-in + this one
  });

  it("resolves the current user from the session cookie", async () => {
    const { cookie } = await signIn();
    requestHeaders = new Headers({ cookie });

    const session = await getSession();
    expect(session?.user.email).toBe("ani@example.am");
    expect(session?.user.platformRole).toBe("customer");
  });

  it("revokes the session on sign out", async () => {
    const { cookie } = await signIn();
    await auth.api.signOut({ headers: new Headers({ cookie }) });

    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
});

describe("suspended users", () => {
  beforeEach(() => signUp());

  it("cannot sign in", async () => {
    await db.update(users).set({ status: "suspended" });
    const { response } = await signIn();
    expect(response.ok).toBe(false);
  });

  it("are signed out of existing sessions immediately", async () => {
    const { cookie } = await signIn();
    await db.update(users).set({ status: "suspended" });
    requestHeaders = new Headers({ cookie });

    expect(await getSession()).toBeNull();
  });
});
