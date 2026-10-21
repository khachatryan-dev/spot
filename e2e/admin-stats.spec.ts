import { expect, sql, test } from "./fixtures";
import { expectAccessible } from "./helpers";

/** §4.2: platform admins see active restaurants, activity and customers. */
test("an admin sees platform statistics", async ({ page }) => {
  const stamp = Date.now();
  const [restaurant] = await sql`
    INSERT INTO restaurants (name, slug, status) VALUES (${`Ակտիվ ${stamp}`}, ${`active-${stamp}`}, 'active')
    RETURNING id`;
  await sql`
    INSERT INTO analytics_events (name, restaurant_id, visitor_key)
    VALUES ('qr_scanned', ${restaurant!.id}, ${`e2e-visitor-${stamp}`})`;

  const adminEmail = `admin-${stamp}@example.am`;
  await page.goto("/register");
  await page.getByLabel("Անուն").fill("Ադմին");
  await page.getByLabel("Էլ. փոստ").fill(adminEmail);
  await page.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL("/home");
  await sql`UPDATE users SET platform_role = 'platform_admin' WHERE email = ${adminEmail}`;

  await page.goto("/admin/stats");
  await expect(page.getByRole("heading", { name: "Հարթակի վիճակագրություն" })).toBeVisible();
  const active = page.getByRole("region", { name: "Ակտիվ" });
  const restaurants = Number(await active.getByRole("definition").first().textContent());
  expect(restaurants).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("region", { name: "Հաճախորդներ" })).toBeVisible();
  await expect(page.getByRole("figure", { name: "QR սկանավորումներն ըստ օրերի" })).toBeVisible();
  await expectAccessible(page, "platform statistics");

  await page.getByRole("link", { name: "7 օր" }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(
    page.getByRole("figure", { name: "Պատվերներն ըստ օրերի" }).getByRole("table"),
  ).toHaveCount(1);
});
