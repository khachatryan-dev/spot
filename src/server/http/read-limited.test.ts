import { describe, expect, it } from "vitest";

import { readLimitedText } from "./read-limited";

const post = (body: BodyInit, headers: HeadersInit = {}) =>
  new Request("https://spot.test/x", { method: "POST", body, headers });

describe("readLimitedText", () => {
  it("reads bodies up to the limit", async () => {
    expect(await readLimitedText(post("hello"), 5)).toBe("hello");
    expect(await readLimitedText(new Request("https://spot.test/x"), 5)).toBe("");
  });

  it("refuses bodies over the limit, whatever Content-Length claims", async () => {
    await expect(readLimitedText(post("too long"), 5)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      readLimitedText(post("x", { "content-length": "999999" }), 5),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abc"));
        controller.enqueue(new TextEncoder().encode("def"));
        controller.close();
      },
    });
    await expect(
      readLimitedText(
        new Request("https://spot.test/x", {
          method: "POST",
          body: stream,
          duplex: "half",
        } as RequestInit),
        5,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
