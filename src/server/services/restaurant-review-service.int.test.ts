import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { auditLogs, restaurants, restaurantStaff, reviews, users } from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";
import { orderingSetup, orderRequest } from "@/test/ordering-fixtures";

import { changeOrderStatus, createOrder } from "./order-service";
import { listRestaurantReviews, reportReview, respondToReview } from "./restaurant-review-service";
import { createReview, getReviewSummary } from "./review-service";
import { closeTableSession } from "./table-session-service";

beforeEach(() => truncate(db, ["restaurants", "users", "guests", "rate_limits", "audit_logs"]));

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

/** A served, closed visit with Ani's 3-star review. */
async function reviewed() {
  const s = await orderingSetup();
  const order = await createOrder(s.ani, s.session.id, orderRequest(s));
  for (const to of ["accepted", "ready", "served"] as const) {
    await changeOrderStatus(s.owner, s.restaurantId, order.id, to);
  }
  await closeTableSession(s.owner, s.restaurantId, s.session.id);
  const review = await createReview(s.ani, {
    subject: "visit",
    targetId: s.session.id,
    rating: 3,
    comment: "Slow service",
    email: "ani@x.am",
    displayName: "Ani",
  });
  return { ...s, review };
}

async function staff(restaurantId: string, email: string, role: "manager" | "waiter") {
  const [user] = await db.insert(users).values({ email }).returning();
  await db.insert(restaurantStaff).values({ restaurantId, userId: user!.id, role });
  return user!;
}

describe("restaurant side of reviews", () => {
  it("lists the restaurant's reviews with the published average", async () => {
    const s = await reviewed();
    expect(await listRestaurantReviews(s.owner, s.restaurantId)).toMatchObject({
      average: 3,
      count: 1,
      reviews: [{ displayName: "Ani", rating: 3, comment: "Slow service", locationName: "Main" }],
    });
  });

  it("lets owners and managers reply in public, edit and remove the reply", async () => {
    const s = await reviewed();
    const manager = await staff(s.restaurantId, "m@x.am", "manager");
    const replied = await respondToReview(
      manager,
      s.restaurantId,
      s.review.id,
      "  Sorry — we're adding staff.  ",
    );
    expect(replied).toMatchObject({
      response: "Sorry — we're adding staff.",
      respondedByUserId: manager.id,
    });
    expect((await getReviewSummary(s.restaurantId)).recent[0]!.response).toBe(
      "Sorry — we're adding staff.",
    );

    const removed = await respondToReview(s.owner, s.restaurantId, s.review.id, "");
    expect(removed).toMatchObject({ response: null, respondedAt: null });
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "review.responded"));
    expect(audit).toHaveLength(2);
  });

  it("keeps waiters and other restaurants out", async () => {
    const s = await reviewed();
    const waiter = await staff(s.restaurantId, "w@x.am", "waiter");
    expect(await codeOf(listRestaurantReviews(waiter, s.restaurantId))).toBe("FORBIDDEN");
    expect(await codeOf(respondToReview(waiter, s.restaurantId, s.review.id, "Hi"))).toBe(
      "FORBIDDEN",
    );

    const [other] = await db
      .insert(restaurants)
      .values({ name: "Other", slug: "other", status: "active" })
      .returning();
    const [rival] = await db.insert(users).values({ email: "rival@x.am" }).returning();
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: other!.id, userId: rival!.id, role: "owner" });
    expect(await codeOf(respondToReview(rival!, other!.id, s.review.id, "Fake reply"))).toBe(
      "NOT_FOUND",
    );
    expect(
      await codeOf(reportReview(rival!, other!.id, s.review.id, "Competitor's review!!")),
    ).toBe("NOT_FOUND");
  });

  it("reports a review for moderation without hiding it", async () => {
    const s = await reviewed();
    expect(await codeOf(reportReview(s.owner, s.restaurantId, s.review.id, "short"))).toContain(
      "reasonTooShort",
    );
    const reported = await reportReview(
      s.owner,
      s.restaurantId,
      s.review.id,
      "The guest was never served by us",
    );
    expect(reported).toMatchObject({
      status: "published",
      reportedByUserId: s.owner.id,
      reportReason: "The guest was never served by us",
    });
    expect(reported.reportedAt).toBeInstanceOf(Date);
    expect((await getReviewSummary(s.restaurantId)).count).toBe(1);
  });

  it("answers only published reviews", async () => {
    const s = await reviewed();
    await db.update(reviews).set({ status: "hidden" }).where(eq(reviews.id, s.review.id));
    expect(await codeOf(respondToReview(s.owner, s.restaurantId, s.review.id, "Thanks"))).toBe(
      "CONFLICT",
    );
  });
});
