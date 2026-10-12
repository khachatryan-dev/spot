import "server-only";

import { and, asc, count, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "@/server/audit/record-audit";
import type { SessionUser } from "@/server/auth/session";
import { createToken, hashToken } from "@/server/crypto/tokens";
import { db } from "@/server/db/client";
import {
  restaurants,
  restaurantStaff,
  type StaffInvitation,
  staffInvitations,
  users,
} from "@/server/db/schema";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import type { RestaurantRole } from "@/shared/constants/roles";
import { AppError } from "@/shared/errors";
import { changeRoleSchema, inviteStaffSchema, type InviteStaffInput } from "@/shared/schemas/staff";

type Actor = Pick<SessionUser, "id">;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OPEN_INVITATIONS = 50;

export interface StaffMember {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  role: RestaurantRole;
}

/** Active staff of a restaurant (owners first). */
export async function listStaff(actor: Actor, restaurantId: string): Promise<StaffMember[]> {
  await authorizeRestaurant(actor.id, restaurantId, "staff:read");
  return db
    .select({
      id: restaurantStaff.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: restaurantStaff.role,
    })
    .from(restaurantStaff)
    .innerJoin(users, eq(users.id, restaurantStaff.userId))
    .where(
      and(eq(restaurantStaff.restaurantId, restaurantId), eq(restaurantStaff.status, "active")),
    )
    .orderBy(sql`${restaurantStaff.role} = 'owner' DESC`, asc(users.email));
}

/** Open (not accepted, revoked or expired) invitations, for owners. */
export async function listInvitations(actor: Actor, restaurantId: string) {
  await authorizeRestaurant(actor.id, restaurantId, "staff:manage");
  return db
    .select({
      id: staffInvitations.id,
      email: staffInvitations.email,
      role: staffInvitations.role,
      expiresAt: staffInvitations.expiresAt,
    })
    .from(staffInvitations)
    .where(and(eq(staffInvitations.restaurantId, restaurantId), openInvitation()))
    .orderBy(asc(staffInvitations.createdAt));
}

function openInvitation(now = new Date()) {
  return and(
    isNull(staffInvitations.acceptedAt),
    isNull(staffInvitations.revokedAt),
    gt(staffInvitations.expiresAt, now),
  );
}

/**
 * Invite someone by email. Returns the raw token once — the owner shares the
 * link; only its hash is stored. A new invitation replaces an open one for
 * the same email.
 */
export async function inviteStaff(
  actor: Actor,
  restaurantId: string,
  input: InviteStaffInput,
): Promise<{ invitation: StaffInvitation; token: string }> {
  const access = await authorizeRestaurant(actor.id, restaurantId, "staff:manage");
  if (access.restaurantStatus === "closed") {
    throw new AppError("CONFLICT", "A closed restaurant can't be edited.");
  }
  const { email, role } = inviteStaffSchema.parse(input);

  const [existing] = await db
    .select({ id: restaurantStaff.id })
    .from(restaurantStaff)
    .innerJoin(users, eq(users.id, restaurantStaff.userId))
    .where(
      and(
        eq(restaurantStaff.restaurantId, restaurantId),
        eq(restaurantStaff.status, "active"),
        eq(users.email, email),
      ),
    );
  if (existing) throw new AppError("CONFLICT", "This person is already on the team.");

  const token = createToken();
  const now = new Date();
  const invitation = await db.transaction(async (tx) => {
    // Replace any open invitation for this email (frees the partial unique index).
    await tx
      .update(staffInvitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(staffInvitations.restaurantId, restaurantId),
          eq(staffInvitations.email, email),
          isNull(staffInvitations.acceptedAt),
          isNull(staffInvitations.revokedAt),
        ),
      );
    const [{ value: open } = { value: 0 }] = await tx
      .select({ value: count() })
      .from(staffInvitations)
      .where(and(eq(staffInvitations.restaurantId, restaurantId), openInvitation(now)));
    if (open >= MAX_OPEN_INVITATIONS) {
      throw new AppError("CONFLICT", "Too many open invitations.");
    }
    const [created] = await tx
      .insert(staffInvitations)
      .values({
        restaurantId,
        email,
        role,
        tokenHash: hashToken(token),
        invitedByUserId: actor.id,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      })
      .returning();
    if (!created) throw new Error("Failed to create invitation");
    await recordAudit(tx, {
      actor,
      action: "staff.invited",
      entityType: "invitation",
      entityId: created.id,
      restaurantId,
      metadata: { email, role },
    });
    return created;
  });
  return { invitation, token };
}

export async function revokeInvitation(actor: Actor, restaurantId: string, invitationId: string) {
  await authorizeRestaurant(actor.id, restaurantId, "staff:manage");
  if (!z.uuid().safeParse(invitationId).success) throw new AppError("NOT_FOUND");
  await db.transaction(async (tx) => {
    const [revoked] = await tx
      .update(staffInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(staffInvitations.id, invitationId),
          eq(staffInvitations.restaurantId, restaurantId),
          isNull(staffInvitations.acceptedAt),
          isNull(staffInvitations.revokedAt),
        ),
      )
      .returning({ id: staffInvitations.id, email: staffInvitations.email });
    if (!revoked) throw new AppError("NOT_FOUND", "Invitation not found.");
    await recordAudit(tx, {
      actor,
      action: "staff.invitation_revoked",
      entityType: "invitation",
      entityId: revoked.id,
      restaurantId,
      metadata: { email: revoked.email },
    });
  });
}

/** Lock the restaurant's staff rows and count active owners (serializes owner changes). */
async function activeOwnerCount(tx: Tx, restaurantId: string) {
  await tx.execute(
    sql`SELECT id FROM ${restaurantStaff} WHERE ${restaurantStaff.restaurantId} = ${restaurantId} FOR UPDATE`,
  );
  const [row] = await tx
    .select({ value: count() })
    .from(restaurantStaff)
    .where(
      and(
        eq(restaurantStaff.restaurantId, restaurantId),
        eq(restaurantStaff.status, "active"),
        eq(restaurantStaff.role, "owner"),
      ),
    );
  return row?.value ?? 0;
}

async function findMember(tx: Tx, restaurantId: string, memberId: string) {
  if (!z.uuid().safeParse(memberId).success) return null;
  const [member] = await tx
    .select()
    .from(restaurantStaff)
    .where(
      and(
        eq(restaurantStaff.id, memberId),
        eq(restaurantStaff.restaurantId, restaurantId),
        eq(restaurantStaff.status, "active"),
      ),
    );
  return member ?? null;
}

/** Change a member's role. The last owner can't be demoted. */
export async function changeStaffRole(
  actor: Actor,
  restaurantId: string,
  memberId: string,
  input: { role: RestaurantRole },
) {
  await authorizeRestaurant(actor.id, restaurantId, "staff:manage");
  const { role } = changeRoleSchema.parse(input);

  await db.transaction(async (tx) => {
    const owners = await activeOwnerCount(tx, restaurantId);
    const member = await findMember(tx, restaurantId, memberId);
    if (!member) throw new AppError("NOT_FOUND", "Staff member not found.");
    if (member.role === "owner" && role !== "owner" && owners <= 1) {
      throw new AppError("CONFLICT", "A restaurant needs at least one owner.");
    }
    await tx.update(restaurantStaff).set({ role }).where(eq(restaurantStaff.id, member.id));
    await recordAudit(tx, {
      actor,
      action: "staff.role_changed",
      entityType: "staff",
      entityId: member.id,
      restaurantId,
      metadata: { userId: member.userId, from: member.role, to: role },
    });
  });
}

/** Remove (disable) a member; history is kept. The last owner can't be removed. */
export async function removeStaff(actor: Actor, restaurantId: string, memberId: string) {
  await authorizeRestaurant(actor.id, restaurantId, "staff:manage");

  await db.transaction(async (tx) => {
    const owners = await activeOwnerCount(tx, restaurantId);
    const member = await findMember(tx, restaurantId, memberId);
    if (!member) throw new AppError("NOT_FOUND", "Staff member not found.");
    if (member.role === "owner" && owners <= 1) {
      throw new AppError("CONFLICT", "A restaurant needs at least one owner.");
    }
    await tx
      .update(restaurantStaff)
      .set({ status: "disabled" })
      .where(eq(restaurantStaff.id, member.id));
    await recordAudit(tx, {
      actor,
      action: "staff.removed",
      entityType: "staff",
      entityId: member.id,
      restaurantId,
      metadata: { userId: member.userId, role: member.role },
    });
  });
}

export type InvitationPreview =
  | { status: "valid"; restaurantName: string; role: RestaurantRole; email: string }
  | { status: "invalid" };

/** What the invite page shows. Expired, used and unknown tokens all look the same. */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const [row] = await db
    .select({
      restaurantName: restaurants.name,
      restaurantStatus: restaurants.status,
      role: staffInvitations.role,
      email: staffInvitations.email,
    })
    .from(staffInvitations)
    .innerJoin(restaurants, eq(restaurants.id, staffInvitations.restaurantId))
    .where(and(eq(staffInvitations.tokenHash, hashToken(token)), openInvitation()));
  if (!row || row.restaurantStatus === "closed") return { status: "invalid" };
  return { status: "valid", restaurantName: row.restaurantName, role: row.role, email: row.email };
}

/**
 * Accept an invitation as the signed-in user. Their email must match the
 * invitation, so a forwarded link is useless to anyone else.
 */
export async function acceptInvitation(
  actor: Pick<SessionUser, "id" | "email">,
  token: string,
): Promise<{ restaurantId: string }> {
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(staffInvitations)
      .where(and(eq(staffInvitations.tokenHash, hashToken(token)), openInvitation()))
      .for("update");
    if (!invitation) throw new AppError("NOT_FOUND", "This invitation is no longer valid.");
    if (invitation.email !== actor.email.toLowerCase()) {
      throw new AppError("FORBIDDEN", "This invitation was sent to a different email.");
    }

    // Reactivate a previous membership or create a new one.
    const [member] = await tx
      .insert(restaurantStaff)
      .values({
        restaurantId: invitation.restaurantId,
        userId: actor.id,
        role: invitation.role,
        invitedByUserId: invitation.invitedByUserId,
      })
      .onConflictDoUpdate({
        target: [restaurantStaff.restaurantId, restaurantStaff.userId],
        set: { role: invitation.role, status: "active" },
        // Never downgrade someone who is already active staff.
        setWhere: ne(restaurantStaff.status, "active"),
      })
      .returning({ id: restaurantStaff.id });

    await tx
      .update(staffInvitations)
      .set({ acceptedAt: new Date(), acceptedByUserId: actor.id })
      .where(eq(staffInvitations.id, invitation.id));
    // `member` is undefined when they were already active staff (nothing changed).
    if (member) {
      await recordAudit(tx, {
        actor,
        action: "staff.joined",
        entityType: "staff",
        entityId: member.id,
        restaurantId: invitation.restaurantId,
        metadata: { role: invitation.role, invitationId: invitation.id },
      });
    }
    return { restaurantId: invitation.restaurantId };
  });
}
