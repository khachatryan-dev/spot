import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { createLogger, type LogLevel } from "./logger";

function setup(level: LogLevel = "debug") {
  const lines: { line: string; level: LogLevel }[] = [];
  const logger = createLogger({
    level,
    format: "json",
    write: (line, lineLevel) => lines.push({ line, level: lineLevel }),
  });
  const entries = () => lines.map(({ line }) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, entries };
}

beforeEach(() => captureException.mockClear());

describe("createLogger", () => {
  it("writes one JSON entry with level, time, message and context", () => {
    const { logger, entries } = setup();
    logger.info("Order created", { orderId: "o1" });

    const [entry] = entries();
    expect(entry).toMatchObject({ level: "info", msg: "Order created", orderId: "o1" });
    expect(typeof entry?.time).toBe("string");
  });

  it("skips entries below the minimum level", () => {
    const { logger, entries } = setup("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    expect(entries().map((e) => e.level)).toEqual(["warn"]);
  });

  it("redacts secrets in context", () => {
    const { logger, lines } = setup();
    logger.info("Login", { email: "a@b.am", password: "hunter2" });
    expect(lines[0]?.line).not.toContain("hunter2");
  });

  it("adds child bindings to every entry", () => {
    const { logger, entries } = setup();
    logger.child({ module: "orders" }).child({ restaurantId: "r1" }).info("x");
    expect(entries()[0]).toMatchObject({ module: "orders", restaurantId: "r1" });
  });

  it("reports errors with `err` to Sentry and serializes them", () => {
    const { logger, entries } = setup();
    const err = new Error("boom");
    logger.error("Failed", { err });

    expect(captureException).toHaveBeenCalledWith(err, expect.anything());
    expect(entries()[0]?.err).toMatchObject({ name: "Error", message: "boom" });
  });

  it("does not report to Sentry without an error", () => {
    const { logger } = setup();
    logger.error("Something odd");
    logger.warn("w", { err: new Error("x") });
    expect(captureException).not.toHaveBeenCalled();
  });
});
