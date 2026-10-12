import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AppError } from "@/shared/errors";

import { action, fail, ok, route } from "./response";

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => consoleError.mockClear());

describe("ok", () => {
  it("wraps data with a null error", async () => {
    const res = ok({ id: "r1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: "r1" }, error: null });
  });

  it("accepts a custom status", () => {
    expect(ok({ id: "r1" }, { status: 201 }).status).toBe(201);
  });
});

describe("fail", () => {
  it("maps an AppError to its status, code, and message", async () => {
    const res = fail(new AppError("NOT_FOUND", "Order not found"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      data: null,
      error: { code: "NOT_FOUND", message: "Order not found" },
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("turns a ZodError into VALIDATION_ERROR with field errors", async () => {
    const parsed = z.object({ email: z.email(), guests: z.number().min(1) }).safeParse({
      email: "nope",
      guests: 0,
    });
    const res = fail(parsed.error);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(body.error.fieldErrors)).toEqual(["email", "guests"]);
  });

  it("hides unknown errors behind INTERNAL_ERROR and logs them", async () => {
    const res = fail(new Error('relation "orders" does not exist'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
    });
    expect(JSON.stringify(body)).not.toContain("relation");
    expect(consoleError).toHaveBeenCalledOnce();
  });
});

describe("route", () => {
  it("passes through successful responses", async () => {
    const handler = route(async (id: string) => ok({ id }));
    expect(await (await handler("t1")).json()).toEqual({ data: { id: "t1" }, error: null });
  });

  it("converts thrown errors into error responses", async () => {
    const handler = route(async () => {
      throw new AppError("FORBIDDEN");
    });
    const res = await handler();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });
});

describe("action", () => {
  it("returns data on success", async () => {
    expect(await action(async () => 42)).toEqual({ data: 42, error: null });
  });

  it("returns a safe error on failure", async () => {
    const result = await action(async () => {
      throw new AppError("RESERVATION_UNAVAILABLE");
    });
    expect(result).toEqual({
      data: null,
      error: {
        code: "RESERVATION_UNAVAILABLE",
        message: "This reservation slot is not available.",
      },
    });
  });
});
