import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { clientEnvSchema, parseEnv, serverEnvSchema } from "./src/shared/config/env-schema";
import { SECURITY_HEADERS } from "./src/shared/security/csp";

// Fail fast on `next dev` / `next build` if the environment is invalid.
parseEnv(serverEnvSchema, process.env, "server");
parseEnv(clientEnvSchema, process.env, "client");

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The page CSP (with a nonce) is set per request in src/proxy.ts.
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default withNextIntl(nextConfig);
