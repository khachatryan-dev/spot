import { describe, expect, it } from "vitest";

import { realtimeChannels } from "./channels";
import { getRealtimePublisher, isRealtimeEnabled, setRealtimePublisherForTests } from "./realtime";

describe("realtime", () => {
  it("names channels consistently", () => {
    expect(realtimeChannels.location("r1", "l1")).toBe("restaurant:r1:location:l1");
    expect(realtimeChannels.session("s1")).toBe("session:s1");
  });

  it("is a silent no-op without an Ably key", async () => {
    setRealtimePublisherForTests(undefined);
    expect(isRealtimeEnabled()).toBe(false);
    await expect(
      getRealtimePublisher().publish("session:x", { type: "ORDER_CREATED", id: "o1" }),
    ).resolves.toBeUndefined();
  });

  it("can be replaced in tests", async () => {
    const sent: unknown[] = [];
    setRealtimePublisherForTests({
      publish: async (channel, hint) => void sent.push({ channel, hint }),
    });
    await getRealtimePublisher().publish("session:x", { type: "ORDER_CREATED", id: "o1" });
    expect(sent).toEqual([{ channel: "session:x", hint: { type: "ORDER_CREATED", id: "o1" } }]);
    setRealtimePublisherForTests(undefined);
  });
});
