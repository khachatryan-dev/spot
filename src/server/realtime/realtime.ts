import "server-only";

import Ably from "ably";

import { logger } from "@/server/logger";
import { env } from "@/shared/config/env";

import type { RealtimeHint } from "./channels";

/*
 * Realtime publishing (ADR 0001). Ably when ABLY_API_KEY is set; otherwise a
 * no-op, and screens keep polling. Publishing never throws: the database
 * change already happened, a lost hint only means a slower refresh.
 */

export interface RealtimePublisher {
  publish(channel: string, hint: RealtimeHint): Promise<void>;
}

const log = logger.child({ module: "realtime" });

const noop: RealtimePublisher = {
  async publish() {},
};

function ablyPublisher(key: string): RealtimePublisher {
  const client = new Ably.Rest({ key });
  return {
    async publish(channel, hint) {
      try {
        await client.channels.get(channel).publish(hint.type, hint);
      } catch (err) {
        log.warn("Realtime publish failed", { err, channel, type: hint.type });
      }
    },
  };
}

let publisher: RealtimePublisher | undefined;

export function getRealtimePublisher(): RealtimePublisher {
  publisher ??= env.ABLY_API_KEY ? ablyPublisher(env.ABLY_API_KEY) : noop;
  return publisher;
}

/** Tests can swap in a recording publisher. */
export function setRealtimePublisherForTests(next: RealtimePublisher | undefined) {
  publisher = next;
}

export const isRealtimeEnabled = () => Boolean(env.ABLY_API_KEY);
