import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;
const BASE_URL = `http://localhost:${PORT}`;
/** E2E runs against the test database, never the dev database. */
const DATABASE_URL = "postgresql://spot:spot@localhost:5432/spot_test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/global-setup.ts",
  // Navigations hit a real production server; 5s was too tight on a busy machine or CI.
  expect: { timeout: 10_000 },
  // Each test sets up a whole restaurant (register, location, table, QR) via the UI.
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    locale: "hy-AM",
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: {
    // Production build, same as real users get.
    command: `npx next build && npx next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL,
      AUTH_URL: BASE_URL,
      NEXT_PUBLIC_APP_URL: BASE_URL,
      STORAGE_ENDPOINT: "http://localhost:9000",
      STORAGE_ACCESS_KEY: "minioadmin",
      STORAGE_SECRET_KEY: "minioadmin",
      STORAGE_BUCKET: "spot-uploads-test",
      STORAGE_REGION: "us-east-1",
      NEXT_PUBLIC_STORAGE_URL: "http://localhost:9000/spot-uploads-test",
      CRON_SECRET: "e2e-cron-secret-0123456789",
      // Test payments (the fake provider and its /dev/pay page); no money moves.
      PAYMENT_PROVIDER: "fake",
    },
  },
});
