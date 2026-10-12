import { expect, sql, test } from "./fixtures";
import { expectAccessible } from "./helpers";

/** Platform admins see problems first, totals, and each payment's history. */
test("an admin monitors payments and opens one with a failed refund", async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const [restaurant] = await sql`
    INSERT INTO restaurants (name, slug, status) VALUES (${`Վճարումների ${stamp}`}, ${`pay-${stamp}`}, 'active')
    RETURNING id, name`;
  const [paid] = await sql`
    INSERT INTO payments (restaurant_id, purpose, amount_minor, currency, status, provider, provider_payment_id, idempotency_key, succeeded_at)
    VALUES (${restaurant!.id}, 'bill', 1250000, 'AMD', 'succeeded', 'fake', ${`fake_${stamp}_a`}, ${`e2e-pay-${stamp}-a`}, now())
    RETURNING id`;
  await sql`
    INSERT INTO payment_events (payment_id, provider, type, from_status, to_status, amount_minor)
    VALUES (${paid!.id}, 'fake', 'created', NULL, 'pending', 1250000),
           (${paid!.id}, 'fake', 'status_changed', 'pending', 'succeeded', 1250000)`;
  await sql`
    INSERT INTO payment_refunds (payment_id, restaurant_id, amount_minor, reason, status, idempotency_key, completed_at)
    VALUES (${paid!.id}, ${restaurant!.id}, 1250000, 'Սխալ սեղան', 'failed', ${`e2e-refund-${stamp}`}, now())`;
  await sql`
    INSERT INTO payments (restaurant_id, purpose, amount_minor, currency, status, provider, provider_payment_id, idempotency_key, created_at)
    VALUES (${restaurant!.id}, 'bill', 300000, 'AMD', 'pending', 'fake', ${`fake_${stamp}_b`}, ${`e2e-pay-${stamp}-b`}, now() - interval '2 hours')`;

  const adminEmail = `admin-${stamp}@example.am`;
  await page.goto("/register");
  await page.getByLabel("Անուն").fill("Ադմին");
  await page.getByLabel("Էլ. փոստ").fill(adminEmail);
  await page.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL("/");
  await sql`UPDATE users SET platform_role = 'platform_admin' WHERE email = ${adminEmail}`;

  await page.goto(`/admin/payments?restaurant=${restaurant!.id}`);
  const problems = page.getByRole("region", { name: /Պահանջում է ուշադրություն/ });
  await expect(problems.getByRole("link").filter({ hasText: restaurant!.name })).toHaveCount(2);
  await expect(problems).toContainText("Վերադարձը չհաջողվեց");
  await expect(problems).toContainText("Մատակարարից պատասխան չկա մեկ ժամից ավելի");
  await expect(page.getByRole("definition").filter({ hasText: /12.500.֏/ })).toBeVisible();
  await expectAccessible(page, "admin payments");

  await page.getByLabel("Կարգավիճակ").selectOption("pending");
  await page.getByRole("button", { name: "Կիրառել" }).click();
  await expect(page.getByRole("list", { name: "Վճարումներ" }).getByRole("listitem")).toHaveCount(1);

  await page.goto(`/admin/payments/${paid!.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/12.500.֏/);
  await expect(page.getByRole("region", { name: "Պատմություն" })).toContainText(
    "pending → succeeded",
  );
  await expect(page.getByRole("region", { name: "Վերադարձներ" })).toContainText("Սխալ սեղան");
  await expect(page.getByRole("region", { name: "Վերադարձներ" })).toContainText("չհաջողվեց");
  await expectAccessible(page, "admin payment detail");
});
