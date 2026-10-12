import { describe, expect, it } from "vitest";

import { AppError } from "@/shared/errors";

import { REDACTED, redact, serializeError } from "./redact";

describe("redact", () => {
  it("hides sensitive keys at any depth, case-insensitively", () => {
    expect(
      redact({
        email: "a@b.am",
        password: "hunter2",
        user: { accessToken: "t", Authorization: "Bearer x" },
        payment: { cardNumber: "4111", amount: 5000 },
      }),
    ).toEqual({
      email: "a@b.am",
      password: REDACTED,
      user: { accessToken: REDACTED, Authorization: REDACTED },
      payment: { cardNumber: REDACTED, amount: 5000 },
    });
  });

  it("handles arrays and circular references", () => {
    const node: Record<string, unknown> = { id: 1 };
    node.self = node;
    expect(redact([{ secret: "s" }, node])).toEqual([
      { secret: REDACTED },
      { id: 1, self: "[Circular]" },
    ]);
  });

  it("does not mutate the input", () => {
    const input = { password: "p" };
    redact(input);
    expect(input.password).toBe("p");
  });
});

describe("serializeError", () => {
  it("keeps name, message, code and the cause chain", () => {
    const error = new AppError("CONFLICT", "Table taken", { cause: new Error("unique violation") });
    expect(serializeError(error)).toMatchObject({
      name: "AppError",
      message: "Table taken",
      code: "CONFLICT",
      cause: { name: "Error", message: "unique violation" },
    });
  });
});
