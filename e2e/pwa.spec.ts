import { devices } from "@playwright/test";

import { expect, test } from "./fixtures";
import { expectAccessible } from "./helpers";

test("Spot can be installed: manifest, icons and app meta tags", async ({ page, request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    short_name: "Spot",
    start_url: "/home",
    display: "standalone",
  });
  const sizes = manifest.icons.map(
    (i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`,
  );
  expect(sizes).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const icon of manifest.icons) {
    const file = await request.get(icon.src);
    expect(file.headers()["content-type"]).toBe("image/png");
  }

  await page.goto("/home");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", /#/);
  await expect(
    page
      .locator('meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]')
      .first(),
  ).toHaveAttribute("content", "yes");
});

test("iPhone guests see how to add Spot to the home screen, and can hide it", async ({
  browser,
}) => {
  const context = await browser.newContext({ ...devices["iPhone 13"], locale: "hy-AM" });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/home");
  const card = page.getByRole("region", { name: "Ավելացրեք Spot-ը գլխավոր էկրանին" });
  await expect(card).toContainText("Ավելացնել գլխավոր էկրանին");
  await expectAccessible(page, "home with the install card");
  await card.getByRole("button", { name: "Փակել" }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(card).toHaveCount(0);
  await context.close();
});
