import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { truncate } from "@/test/db";

import {
  CONTACT_LIMIT,
  countNewContactMessages,
  listContactMessages,
  sendContactMessage,
  setContactMessageStatus,
} from "./contact-service";

beforeEach(() => truncate(db, ["contact_messages", "users", "rate_limits"]));

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message),
  );

const input = {
  name: "Ani",
  email: " Ani@X.am ",
  topic: "restaurant" as const,
  message: "We'd like to put our café on Spot.",
};
const context = { ip: "203.0.113.5", locale: "hy" };

async function people() {
  const [admin, guest] = await db
    .insert(users)
    .values([{ email: "admin@x.am", platformRole: "platform_admin" }, { email: "guest@x.am" }])
    .returning();
  return { admin: admin!, guest: guest! };
}

describe("contact messages", () => {
  it("stores a message and lets admins close and reopen it", async () => {
    const { admin } = await people();
    const sent = await sendContactMessage(input, context);
    expect(sent).toMatchObject({ email: "ani@x.am", status: "new", locale: "hy", userId: null });
    expect(await countNewContactMessages()).toBe(1);
    expect(await listContactMessages(admin, "new")).toMatchObject([{ id: sent.id }]);

    await setContactMessageStatus(admin, sent.id, "handled");
    expect(await countNewContactMessages()).toBe(0);
    expect(await listContactMessages(admin, "handled")).toMatchObject([
      { id: sent.id, handledByUserId: admin.id },
    ]);

    await setContactMessageStatus(admin, sent.id, "new");
    expect(await listContactMessages(admin, "new")).toMatchObject([
      { id: sent.id, handledAt: null },
    ]);
  });

  it("keeps messages away from everyone but platform admins", async () => {
    const { guest } = await people();
    const sent = await sendContactMessage(input, context);
    expect(await codeOf(listContactMessages(guest, "new"))).toBe("FORBIDDEN");
    expect(await codeOf(setContactMessageStatus(guest, sent.id, "handled"))).toBe("FORBIDDEN");
  });

  it("rejects bad input and unknown messages", async () => {
    const { admin } = await people();
    await expect(sendContactMessage({ ...input, message: "hi" }, context)).rejects.toThrow();
    await expect(sendContactMessage({ ...input, email: "nope" }, context)).rejects.toThrow();
    expect(await codeOf(setContactMessageStatus(admin, "not-a-uuid", "handled"))).toBe("NOT_FOUND");
    expect(await codeOf(setContactMessageStatus(admin, crypto.randomUUID(), "handled"))).toBe(
      "NOT_FOUND",
    );
  });

  it("limits how often one address can write", async () => {
    for (let i = 0; i < CONTACT_LIMIT.max; i++) await sendContactMessage(input, context);
    expect(await codeOf(sendContactMessage(input, context))).toBe("RATE_LIMITED");
    await sendContactMessage(input, { ...context, ip: "198.51.100.7" });
  });
});
