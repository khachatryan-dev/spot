import { describe, expect, it } from "vitest";

import { AppError, ERROR_CODES, isAppError } from "./app-error";

describe("AppError", () => {
  it("uses the default safe message and status for its code", () => {
    const error = new AppError("RATE_LIMITED");
    expect(error.status).toBe(429);
    expect(error.message).toBe(ERROR_CODES.RATE_LIMITED.message);
  });

  it("serializes without the internal cause", () => {
    const error = new AppError("CONFLICT", "Table already booked", {
      cause: new Error("duplicate key value violates unique constraint"),
    });
    expect(error.toJSON()).toEqual({ code: "CONFLICT", message: "Table already booked" });
  });

  it("includes field errors when present", () => {
    const error = new AppError("VALIDATION_ERROR", undefined, {
      fieldErrors: { name: ["Required"] },
    });
    expect(error.toJSON().fieldErrors).toEqual({ name: ["Required"] });
  });

  it("is detected by isAppError", () => {
    expect(isAppError(new AppError("NOT_FOUND"))).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
  });
});
