import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { truncate } from "@/test/db";

import { users } from "./users";

beforeEach(() => truncate(db, ["users"]));

/** Postgres error code from a Drizzle query error (wrapped in `cause`). */
const pgCode = (error: unknown) =>
  (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;

async function expectPgError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected the query to fail").not.toBeNull();
  expect(pgCode(error)).toBe(code);
}

describe("users table", () => {
  it("applies defaults: uuid id, customer role, active status, timestamps", async () => {
    const [user] = await db.insert(users).values({ email: "ani@example.am" }).returning();

    expect(user?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user?.platformRole).toBe("customer");
    expect(user?.status).toBe("active");
    expect(user?.createdAt).toBeInstanceOf(Date);
  });

  it("rejects emails that are not lowercase", async () => {
    await expectPgError(db.insert(users).values({ email: "Ani@Example.am" }), "23514");
  });

  it("rejects duplicate emails", async () => {
    await db.insert(users).values({ email: "ani@example.am" });
    await expectPgError(db.insert(users).values({ email: "ani@example.am" }), "23505");
  });

  it("rejects duplicate phone numbers but allows many users without one", async () => {
    await db.insert(users).values([{ email: "a@example.am" }, { email: "b@example.am" }]);
    await db.insert(users).values({ email: "c@example.am", phone: "+37491000000" });
    await expectPgError(
      db.insert(users).values({ email: "d@example.am", phone: "+37491000000" }),
      "23505",
    );
  });

  it("bumps updatedAt on update", async () => {
    const [created] = await db.insert(users).values({ email: "ani@example.am" }).returning();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const [updated] = await db
      .update(users)
      .set({ name: "Ani" })
      .where(eq(users.id, created!.id))
      .returning();

    expect(updated!.updatedAt.getTime()).toBeGreaterThan(created!.updatedAt.getTime());
  });
});
