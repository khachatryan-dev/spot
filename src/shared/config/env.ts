import "server-only";

import { parseEnv, serverEnvSchema } from "./env-schema";

export { clientEnv } from "./env.client";

/** Validated server environment. Importing this from a client component fails the build. */
export const env = parseEnv(serverEnvSchema, process.env, "server");
