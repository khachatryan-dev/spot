import { expect, sql, test } from "./fixtures";
import { expectAccessible, seedMenu, setupActiveTable } from "./helpers";

/** §4.2: the owner sees scans, orders and revenue for their restaurant. */
test("the owner sees their restaurant's statistics", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { restaurantId, locationId, token } = await setupActiveTable(
    page,
    "Վիճակագրության Ռեստորան",
  );
  const { categoryId } = await seedMenu(restaurantId, locationId, "Ըմպելիքներ");
  await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, price_minor)
    VALUES (${restaurantId}, ${categoryId}, 'Սուրճ', 120000)`;

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  await guest.getByRole("article", { name: "Սուրճ" }).getByRole("button").click();
  await guest
    .getByRole("dialog", { name: "Սուրճ" })
    .getByRole("button", { name: /^Ավելացնել · / })
    .click();
  await guest.getByRole("button", { name: /Դիտել պատվերը/ }).click();
  await guest.getByRole("button", { name: "Պատվիրել" }).click();
  await expect(guest).toHaveURL(/\/table\/orders\?placed=/);
  await sql`UPDATE orders SET status = 'served' WHERE restaurant_id = ${restaurantId}`;
  await expect
    .poll(
      async () =>
        (await sql`SELECT id FROM analytics_events WHERE restaurant_id = ${restaurantId}`).length,
    )
    .toBe(1);

  await page.goto(`/dashboard/r/${restaurantId}`);
  await page.getByRole("link", { name: "Վիճակագրություն" }).click();
  await expect(page).toHaveURL(`/dashboard/r/${restaurantId}/stats`);
  const guests = page.getByRole("region", { name: "Հյուրեր" });
  await expect(guests.getByRole("definition").first()).toHaveText("1"); // QR scans
  const ordersSection = page.getByRole("region", { name: "Պատվերներ" });
  await expect(ordersSection).toContainText(/1.200.֏/);
  await expect(ordersSection).toContainText("100%");
  await expect(page.getByRole("region", { name: "Ամենավաճառվողները" })).toContainText("Սուրճ");
  await expectAccessible(page, "restaurant statistics");

  await page.getByRole("link", { name: "7 օր" }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(ordersSection).toContainText(/1.200.֏/);
});
