import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { auditLogs, restaurantLocations, restaurantStaff, users } from "@/server/db/schema";
import { approveRestaurant, rejectRestaurant } from "@/server/services/admin-restaurant-service";
import { listAuditLog } from "@/server/services/audit-service";
import {
  createRestaurant,
  submitForReview,
  updateRestaurant,
} from "@/server/services/restaurant-service";
import { acceptInvitation, changeStaffRole, inviteStaff } from "@/server/services/staff-service";
import { truncate } from "@/test/db";

beforeEach(() =>
  truncate(db, [
    "audit_logs",
    "staff_invitations",
    "restaurant_locations",
    "restaurant_staff",
    "restaurants",
    "users",
  ]),
);

async function createUser(email: string, platformRole: "customer" | "platform_admin" = "customer") {
  const [user] = await db.insert(users).values({ email, platformRole }).returning();
  return user!;
}

async function submitted() {
  const owner = await createUser("owner@example.am");
  const restaurant = await createRestaurant(owner, { name: "Cafe" });
  await db.insert(restaurantLocations).values({
    restaurantId: restaurant.id,
    name: "Main",
    slug: "main",
    addressLine: "1 Abovyan",
    city: "Yerevan",
  });
  await submitForReview(owner, restaurant.id);
  return { owner, restaurant };
}

const actions = async () =>
  (await db.select({ action: auditLogs.action }).from(auditLogs).orderBy(auditLogs.occurredAt)).map(
    (r) => r.action,
  );

describe("audit log", () => {
  it("records the restaurant lifecycle with actor email and details", async () => {
    const admin = await createUser("admin@example.am", "platform_admin");
    const { owner, restaurant } = await submitted();
    await updateRestaurant(owner, restaurant.id, { description: "Nice", phone: "+37410000000" });
    await rejectRestaurant(admin, restaurant.id, { reason: "Please add opening hours." });

    expect(await actions()).toEqual([
      "restaurant.created",
      "restaurant.submitted",
      "restaurant.updated",
      "restaurant.rejected",
    ]);
    const [rejected] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "restaurant.rejected"));
    expect(rejected).toMatchObject({
      actorUserId: admin.id,
      actorEmail: "admin@example.am",
      entityType: "restaurant",
      entityId: restaurant.id,
      restaurantId: restaurant.id,
      metadata: { from: "pending_review", to: "draft", reason: "Please add opening hours." },
    });
    const [updated] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "restaurant.updated"));
    expect(updated?.metadata).toEqual({ fields: ["description", "phone"] });
  });

  it("records staff changes with before and after", async () => {
    const owner = await createUser("owner@example.am");
    const restaurant = await createRestaurant(owner, { name: "Cafe" });
    const waiter = await createUser("waiter@example.am");
    const { token } = await inviteStaff(owner, restaurant.id, {
      email: waiter.email,
      role: "waiter",
    });
    await acceptInvitation(waiter, token);
    const [member] = await db
      .select()
      .from(restaurantStaff)
      .where(eq(restaurantStaff.userId, waiter.id));
    await changeStaffRole(owner, restaurant.id, member!.id, { role: "manager" });

    const [roleChange] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "staff.role_changed"));
    expect(roleChange?.metadata).toEqual({ userId: waiter.id, from: "waiter", to: "manager" });
    expect(await actions()).toEqual([
      "restaurant.created",
      "staff.invited",
      "staff.joined",
      "staff.role_changed",
    ]);
  });

  it("writes nothing when the change itself fails", async () => {
    const admin = await createUser("admin@example.am", "platform_admin");
    const { restaurant } = await submitted();
    await approveRestaurant(admin, restaurant.id);
    await approveRestaurant(admin, restaurant.id).catch(() => null); // already active → CONFLICT

    expect((await actions()).filter((a) => a === "restaurant.approved")).toHaveLength(1);
  });

  it("is append-only: entries can't be edited or deleted", async () => {
    await submitted();
    await expect(db.update(auditLogs).set({ action: "restaurant.approved" })).rejects.toThrow();
    await expect(db.delete(auditLogs)).rejects.toThrow();
    await expect(
      db.execute(sql`UPDATE audit_logs SET actor_email = 'someone@else'`),
    ).rejects.toThrow();
    expect(await actions()).toEqual(["restaurant.created", "restaurant.submitted"]);
  });

  it("keeps entries readable after the actor's account is deleted", async () => {
    const { owner } = await submitted();
    await db.delete(restaurantStaff);
    await db.delete(users).where(eq(users.id, owner.id));

    const entries = await db.select().from(auditLogs);
    expect(entries.every((e) => e.actorEmail === "owner@example.am")).toBe(true);
  });

  it("is listed for platform admins only", async () => {
    const admin = await createUser("admin@example.am", "platform_admin");
    const { owner, restaurant } = await submitted();

    const entries = await listAuditLog(admin, { restaurantId: restaurant.id });
    expect(entries[0]).toMatchObject({ action: "restaurant.submitted", restaurantName: "Cafe" });
    await expect(listAuditLog(owner)).rejects.toThrow();
  });
});
