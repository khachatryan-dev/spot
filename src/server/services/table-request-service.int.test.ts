import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import {
  restaurantLocations,
  restaurants,
  restaurantStaff,
  tableRequests,
  tableSessions,
  users,
} from "@/server/db/schema";
import type { Customer } from "@/server/guests/current-customer";
import { createGuest } from "@/server/guests/guest-service";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import { ensureTableQr, resolveQrToken } from "./qr-service";
import { createRestaurant } from "./restaurant-service";
import { createTable } from "./table-service";
import {
  cancelTableRequest,
  createTableRequest,
  listOpenTableRequests,
  listTableRequestsForCustomer,
  updateTableRequest,
} from "./table-request-service";
import { joinTableSession } from "./table-session-service";

beforeEach(() => truncate(db, ["restaurants", "users", "guests", "rate_limits"]));

async function guest(): Promise<Customer> {
  return { type: "guest", guest: (await createGuest()).guest };
}

async function setup() {
  const [owner] = await db.insert(users).values({ email: "owner@example.am" }).returning();
  const restaurant = await createRestaurant(owner!, { name: "Request Cafe" });
  await db.update(restaurants).set({ status: "active" }).where(eq(restaurants.id, restaurant.id));
  const [location] = await db
    .insert(restaurantLocations)
    .values({
      restaurantId: restaurant.id,
      name: "Main",
      slug: "main",
      addressLine: "1 St",
      city: "Yerevan",
    })
    .returning();
  const table = await createTable(owner!, restaurant.id, { locationId: location!.id, number: "5" });
  const { token } = await ensureTableQr(owner!, restaurant.id, table.id);
  const ani = await guest();
  const session = await joinTableSession(ani, (await resolveQrToken(token))!);
  return {
    owner: owner!,
    restaurantId: restaurant.id,
    locationId: location!.id,
    token,
    ani,
    session,
  };
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).name),
  );

describe("table requests", () => {
  it("lets guests ask, and asking again returns the same open request", async () => {
    const s = await setup();
    const bill = await createTableRequest(s.ani, s.session.id, { type: "bill" });
    const again = await createTableRequest(s.ani, s.session.id, { type: "bill" });
    expect(again.id).toBe(bill.id);
    await createTableRequest(s.ani, s.session.id, { type: "waiter" });
    expect((await listTableRequestsForCustomer(s.ani, s.session.id)).map((r) => r.type)).toEqual([
      "bill",
      "waiter",
    ]);

    const racing = await Promise.all([
      createTableRequest(s.ani, s.session.id, { type: "water" }),
      createTableRequest(s.ani, s.session.id, { type: "water" }),
    ]);
    expect(racing[0].id).toBe(racing[1].id);
  });

  it("is shown to staff, who acknowledge and complete it", async () => {
    const s = await setup();
    const request = await createTableRequest(s.ani, s.session.id, { type: "bill" });

    const [open] = await listOpenTableRequests(s.owner, s.restaurantId, s.locationId);
    expect(open).toMatchObject({
      id: request.id,
      type: "bill",
      status: "pending",
      tableNumber: "5",
    });

    await updateTableRequest(s.owner, s.restaurantId, request.id, "acknowledged");
    expect((await listTableRequestsForCustomer(s.ani, s.session.id))[0]?.status).toBe(
      "acknowledged",
    );
    const done = await updateTableRequest(s.owner, s.restaurantId, request.id, "completed");
    expect(done).toMatchObject({ status: "completed", completedByUserId: s.owner.id });
    expect(await listOpenTableRequests(s.owner, s.restaurantId, s.locationId)).toEqual([]);
    expect(
      await codeOf(updateTableRequest(s.owner, s.restaurantId, request.id, "acknowledged")),
    ).toBe("CONFLICT");

    // After completion, the same thing can be asked for again.
    expect((await createTableRequest(s.ani, s.session.id, { type: "bill" })).id).not.toBe(
      request.id,
    );
  });

  it("lets guests cancel their table's open requests only", async () => {
    const s = await setup();
    const request = await createTableRequest(s.ani, s.session.id, { type: "waiter" });
    expect(await codeOf(cancelTableRequest(await guest(), s.session.id, request.id))).toBe(
      "NOT_FOUND",
    );
    await cancelTableRequest(s.ani, s.session.id, request.id);
    expect(await listTableRequestsForCustomer(s.ani, s.session.id)).toEqual([]);
  });

  it("refuses outsiders and closed visits", async () => {
    const s = await setup();
    expect(await codeOf(createTableRequest(await guest(), s.session.id, { type: "bill" }))).toBe(
      "NOT_FOUND",
    );
    await db
      .update(tableSessions)
      .set({ status: "closed", closedAt: new Date(), closedReason: "staff" })
      .where(eq(tableSessions.id, s.session.id));
    expect(await codeOf(createTableRequest(s.ani, s.session.id, { type: "bill" }))).toBe(
      "NOT_FOUND",
    );
    expect(await db.select().from(tableRequests)).toHaveLength(0);
  });

  it("is handled by waiters and managers — not the kitchen or other restaurants", async () => {
    const s = await setup();
    const request = await createTableRequest(s.ani, s.session.id, { type: "water" });
    const staff = async (email: string, role: "kitchen" | "waiter") => {
      const [user] = await db.insert(users).values({ email }).returning();
      await db
        .insert(restaurantStaff)
        .values({ restaurantId: s.restaurantId, userId: user!.id, role });
      return user!;
    };
    const cook = await staff("cook@example.am", "kitchen");
    const waiter = await staff("waiter@example.am", "waiter");
    expect(await codeOf(listOpenTableRequests(cook, s.restaurantId, s.locationId))).toBe(
      "FORBIDDEN",
    );
    await expect(
      updateTableRequest(waiter, s.restaurantId, request.id, "completed"),
    ).resolves.toMatchObject({ status: "completed" });

    const [other] = await db.insert(users).values({ email: "other@example.am" }).returning();
    const theirs = await createRestaurant(other!, { name: "Other place" });
    expect(await codeOf(updateTableRequest(other!, theirs.id, request.id, "completed"))).toBe(
      "CONFLICT",
    );
  });

  it("limits request spam per visit", async () => {
    const s = await setup();
    const types = ["waiter", "bill", "water", "assistance", "other"] as const;
    let blocked = false;
    for (let i = 0; i < 20 && !blocked; i++) {
      const type = types[i % types.length]!;
      const result = await codeOf(createTableRequest(s.ani, s.session.id, { type }));
      if (result === "RATE_LIMITED") blocked = true;
      else {
        const [open] = await listTableRequestsForCustomer(s.ani, s.session.id);
        if (open) await cancelTableRequest(s.ani, s.session.id, open.id);
      }
    }
    expect(blocked).toBe(true);
  });
});
