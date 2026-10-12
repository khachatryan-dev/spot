import path from "node:path";

import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL = "postgresql://spot:spot@localhost:5432/spot_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside Next's server bundle; it's a no-op in tests.
      "server-only": path.resolve(import.meta.dirname, "src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    // Tests never read .env.local; they always use the separate test database.
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
      LOG_LEVEL: "warn",
      STORAGE_ENDPOINT: "http://localhost:9000",
      STORAGE_ACCESS_KEY: "minioadmin",
      STORAGE_SECRET_KEY: "minioadmin",
      STORAGE_BUCKET: "spot-uploads-test",
      STORAGE_REGION: "us-east-1",
      NEXT_PUBLIC_STORAGE_URL: "http://localhost:9000/spot-uploads-test",
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: ["src/**/*.int.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          globalSetup: ["src/test/db-global-setup.ts"],
          // Tests share one database; run files one at a time.
          fileParallelism: false,
          // Real database + storage I/O, sharing the CPU with the unit tests.
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
    ],
  },
});
