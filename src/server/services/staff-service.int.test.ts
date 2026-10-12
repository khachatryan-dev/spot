import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { restaurantStaff, staffInvitations, users } from "@/server/db/schema";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import { createRestaurant } from "./restaurant-service";
import {
  acceptInvitation,
  changeStaffRole,
  INVITATION_TTL_MS,
  inviteStaff,
  listInvitations,
  listStaff,
  previewInvitation,
  removeStaff,
  revokeInvitation,
} from "./staff-service";

beforeEach(() =>
  truncate(db, [
    "staff_invitations",
    "restaurant_locations",
    "restaurant_staff",
    "restaurants",
    "users",
  ]),
);

async function createUser(email: string) {
  const [user] = await db
    .insert(users)
    .values({ email, name: email.split("@")[0] })
    .returning();
  return user!;
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).name),
  );

async function setup() {
  const owner = await createUser("owner@example.am");
  const restaurant = await createRestaurant(owner, { name: "Cafe" });
  return { owner, restaurant };
}

/** Invite and accept in one go; returns the new member's staff row id. */
async function addMember(
  ownerId: string,
  restaurantId: string,
  email: string,
  role: "waiter" | "owner" | "manager" = "waiter",
) {
  const user = await createUser(email);
  const { token } = await inviteStaff({ id: ownerId }, restaurantId, { email, role });
  await acceptInvitation(user, token);
  const [row] = await db.select().from(restaurantStaff).where(eq(restaurantStaff.userId, user.id));
  return { user, memberId: row!.id };
}

describe("invitations", () => {
  it("stores only a hash and lets the matching user join with the invited role", async () => {
    const { owner, restaurant } = await setup();
    const { token } = await inviteStaff(owner, restaurant.id, {
      email: "Waiter@Example.am",
      role: "waiter",
    });

    const [row] = await db.select().from(staffInvitations);
    expect(row?.email).toBe("waiter@example.am");
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await previewInvitation(token)).toMatchObject({
      status: "valid",
      restaurantName: "Cafe",
      role: "waiter",
    });

    const waiter = await createUser("waiter@example.am");
    await expect(acceptInvitation(waiter, token)).resolves.toEqual({ restaurantId: restaurant.id });
    expect((await authorizeRestaurant(waiter.id, restaurant.id, "order:serve")).role).toBe(
      "waiter",
    );

    // One-time use
    expect(await previewInvitation(token)).toEqual({ status: "invalid" });
    expect(await codeOf(acceptInvitation(waiter, token))).toBe("NOT_FOUND");
  });

  it("refuses a forwarded link opened by someone with a different email", async () => {
    const { owner, restaurant } = await setup();
    const { token } = await inviteStaff(owner, restaurant.id, {
      email: "waiter@example.am",
      role: "manager",
    });
    const stranger = await createUser("stranger@example.am");

    expect(await codeOf(acceptInvitation(stranger, token))).toBe("FORBIDDEN");
    expect(await codeOf(authorizeRestaurant(stranger.id, restaurant.id, "restaurant:read"))).toBe(
      "NOT_FOUND",
    );
  });

  it("expires invitations and lets the owner revoke or replace them", async () => {
    const { owner, restaurant } = await setup();
    const first = await inviteStaff(owner, restaurant.id, {
      email: "a@example.am",
      role: "waiter",
    });
    const second = await inviteStaff(owner, restaurant.id, {
      email: "a@example.am",
      role: "kitchen",
    });

    expect(await previewInvitation(first.token)).toEqual({ status: "invalid" }); // replaced
    expect(await listInvitations(owner, restaurant.id)).toHaveLength(1);

    await revokeInvitation(owner, restaurant.id, second.invitation.id);
    expect(await previewInvitation(second.token)).toEqual({ status: "invalid" });

    const third = await inviteStaff(owner, restaurant.id, {
      email: "b@example.am",
      role: "waiter",
    });
    await db
      .update(staffInvitations)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(staffInvitations.id, third.invitation.id));
    expect(await previewInvitation(third.token)).toEqual({ status: "invalid" });
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("rejects inviting someone who is already on the team", async () => {
    const { owner, restaurant } = await setup();
    expect(
      await codeOf(
        inviteStaff(owner, restaurant.id, { email: "owner@example.am", role: "waiter" }),
      ),
    ).toBe("CONFLICT");
  });

  it("lets only owners manage staff, within their own restaurant", async () => {
    const { owner, restaurant } = await setup();
    const { user: manager } = await addMember(
      owner.id,
      restaurant.id,
      "manager@example.am",
      "manager",
    );
    const outsider = await createUser("out@example.am");
    const invite = { email: "x@example.am", role: "waiter" } as const;

    expect(await codeOf(inviteStaff(manager, restaurant.id, invite))).toBe("FORBIDDEN");
    expect(await codeOf(inviteStaff(outsider, restaurant.id, invite))).toBe("NOT_FOUND");
    expect((await listStaff(manager, restaurant.id)).map((m) => m.role)).toEqual([
      "owner",
      "manager",
    ]);
  });
});

describe("roles and removal", () => {
  it("changes roles but never demotes or removes the last owner", async () => {
    const { owner, restaurant } = await setup();
    const [ownerRow] = await db
      .select()
      .from(restaurantStaff)
      .where(eq(restaurantStaff.userId, owner.id));

    expect(
      await codeOf(changeStaffRole(owner, restaurant.id, ownerRow!.id, { role: "manager" })),
    ).toBe("CONFLICT");
    expect(await codeOf(removeStaff(owner, restaurant.id, ownerRow!.id))).toBe("CONFLICT");

    // With a co-owner, the first owner may step down.
    await addMember(owner.id, restaurant.id, "co@example.am", "owner");
    await changeStaffRole(owner, restaurant.id, ownerRow!.id, { role: "manager" });
    expect((await authorizeRestaurant(owner.id, restaurant.id, "menu:manage")).role).toBe(
      "manager",
    );
  });

  it("disables removed staff and reactivates them when re-invited", async () => {
    const { owner, restaurant } = await setup();
    const { user: waiter, memberId } = await addMember(
      owner.id,
      restaurant.id,
      "waiter@example.am",
    );

    await removeStaff(owner, restaurant.id, memberId);
    expect(await codeOf(authorizeRestaurant(waiter.id, restaurant.id, "order:read"))).toBe(
      "NOT_FOUND",
    );

    const { token } = await inviteStaff(owner, restaurant.id, {
      email: "waiter@example.am",
      role: "cashier",
    });
    await acceptInvitation(waiter, token);
    expect((await authorizeRestaurant(waiter.id, restaurant.id, "payment:confirm")).role).toBe(
      "cashier",
    );
    expect(
      await db.select().from(restaurantStaff).where(eq(restaurantStaff.userId, waiter.id)),
    ).toHaveLength(1);
  });

  it("can't touch members of another restaurant", async () => {
    const { owner, restaurant } = await setup();
    const other = await createUser("other@example.am");
    const theirs = await createRestaurant(other, { name: "Theirs" });
    const [theirOwner] = await db
      .select()
      .from(restaurantStaff)
      .where(eq(restaurantStaff.restaurantId, theirs.id));

    // Own restaurant id + other restaurant's member id
    expect(await codeOf(removeStaff(owner, restaurant.id, theirOwner!.id))).toBe("NOT_FOUND");
  });
});
