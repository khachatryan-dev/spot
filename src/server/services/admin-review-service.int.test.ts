import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { auditLogs, reviews, users } from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { orderingSetup, orderRequest } from "@/test/ordering-fixtures";

import { countOpenReports, listReviewsForModeration, moderateReview } from "./admin-review-service";
import { changeOrderStatus, createOrder } from "./order-service";
import { reportReview } from "./restaurant-review-service";
import { createReview, getReviewSummary } from "./review-service";
import { closeTableSession } from "./table-session-service";

beforeEach(() => truncate(db, ["restaurants", "users", "guests", "rate_limits", "audit_logs"]));

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

/** A published 1-star review, reported by the owner, and a platform admin. */
async function reported() {
  const s = await orderingSetup();
  const order = await createOrder(s.ani, s.session.id, orderRequest(s));
  for (const to of ["accepted", "ready", "served"] as const) {
    await changeOrderStatus(s.owner, s.restaurantId, order.id, to);
  }
  await closeTableSession(s.owner, s.restaurantId, s.session.id);
  const review = await createReview(s.ani, {
    subject: "visit",
    targetId: s.session.id,
    rating: 1,
    comment: "Terrible!!!",
    email: "ani@x.am",
  });
  await reportReview(s.owner, s.restaurantId, review.id, "Abusive and not about the food");
  const [admin] = await db
    .insert(users)
    .values({ email: "admin@x.am", platformRole: "platform_admin" })
    .returning();
  return { ...s, review, admin: admin! };
}

describe("review moderation", () => {
  it("queues reported reviews for admins only", async () => {
    const s = await reported();
    const queue = await listReviewsForModeration(s.admin);
    expect(queue.reported).toMatchObject([
      { id: s.review.id, reportReason: "Abusive and not about the food", authorEmail: "ani@x.am" },
    ]);
    expect(queue.recent).toHaveLength(1);
    expect(await countOpenReports()).toBe(1);
    expect(await codeOf(listReviewsForModeration(s.owner))).toBe("FORBIDDEN");
    expect(
      await codeOf(
        moderateReview(s.owner, s.review.id, { decision: "hide", reason: "x".repeat(10) }),
      ),
    ).toBe("FORBIDDEN");
    expect((await listReviewsForModeration(s.admin, { search: "Order Cafe" })).recent).toHaveLength(
      1,
    );
    expect(
      (await listReviewsForModeration(s.admin, { search: "nothing like it" })).recent,
    ).toHaveLength(0);
  });

  it("keeps a review up and clears the report", async () => {
    const s = await reported();
    const kept = await moderateReview(s.admin, s.review.id, { decision: "keep" });
    expect(kept).toMatchObject({ status: "published", moderatedByUserId: s.admin.id });
    expect((await listReviewsForModeration(s.admin)).reported).toEqual([]);
    expect((await getReviewSummary(s.restaurantId)).count).toBe(1);
  });

  it("hides with a reason (the rating updates), and can restore", async () => {
    const s = await reported();
    expect(await codeOf(moderateReview(s.admin, s.review.id, { decision: "hide" }))).toBe(
      "VALIDATION_ERROR",
    );
    const hidden = await moderateReview(s.admin, s.review.id, {
      decision: "hide",
      reason: "Abusive language",
    });
    expect(hidden).toMatchObject({ status: "hidden", moderationReason: "Abusive language" });
    expect(await getReviewSummary(s.restaurantId)).toMatchObject({ count: 0, average: null });

    await moderateReview(s.admin, s.review.id, { decision: "restore" });
    expect((await getReviewSummary(s.restaurantId)).count).toBe(1);
    const actions = (
      await db.select().from(auditLogs).where(eq(auditLogs.entityId, s.review.id))
    ).map((a) => a.action);
    expect(actions).toEqual(["review.reported", "review.hidden", "review.restored"]);
  });

  it("rejects for good", async () => {
    const s = await reported();
    await moderateReview(s.admin, s.review.id, {
      decision: "reject",
      reason: "Spam from a competitor",
    });
    for (const decision of ["keep", "restore", "hide"] as const) {
      expect(
        await codeOf(moderateReview(s.admin, s.review.id, { decision, reason: "Changed my mind" })),
      ).toBe("CONFLICT");
    }
    const [row] = await db.select().from(reviews).where(eq(reviews.id, s.review.id));
    expect(row!.status).toBe("rejected");
  });
});
