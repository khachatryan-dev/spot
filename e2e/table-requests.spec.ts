import { expect, sql, test } from "./fixtures";
import { seedMenu, setupActiveTable } from "./helpers";

test("guests ask for the bill or a waiter; staff handle it", async ({ page, browser }) => {
  const { restaurantId, locationId, token } = await setupActiveTable(page, "Հաշիվ Ռեստորան");
  await seedMenu(restaurantId, locationId, "Ուտեստներ");

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  const services = guest.getByRole("region", { name: "Կանչել սպասարկում" });
  await services.getByRole("button", { name: "Հաշիվը", exact: true }).click();
  await expect(guest.getByText("Հարցումն ուղարկված է։")).toBeVisible();
  await services.getByRole("button", { name: "Հաշիվը", exact: true }).click({ force: true }); // a second tap changes nothing
  await services.getByRole("button", { name: "Կանչել մատուցողին", exact: true }).click();
  const mine = guest.getByRole("list", { name: "Ձեր հարցումները" });
  await expect(mine.getByRole("status")).toHaveCount(2);
  await expect(mine).toContainText("Հաշիվը · ուղարկված է");
  expect(
    await sql`SELECT id FROM table_requests WHERE restaurant_id = ${restaurantId} AND type = 'bill'`,
  ).toHaveLength(1);

  // Staff see both requests above the order board
  await page.goto(`/dashboard/r/${restaurantId}/orders`);
  const panel = page.getByRole("list", { name: "2 հարցում սեղաններից" });
  await expect(panel).toContainText("Սեղան 1");
  await expect(panel).toContainText("Հաշիվը");
  await expect(panel).toContainText("Կանչել մատուցողին");

  const acknowledge = page.getByRole("button", { name: "Տեսա՝ սեղան 1, Հաշիվը" });
  await acknowledge.click();
  await expect(acknowledge).toHaveCount(0); // saved before the guest looks
  await guest.reload();
  await expect(mine).toContainText("Հաշիվը · գալիս են");

  await page.getByRole("button", { name: "Կատարված՝ սեղան 1, Հաշիվը" }).click();
  await expect(page.getByRole("list", { name: "1 հարցում սեղաններից" })).toBeVisible();

  // The guest withdraws the waiter call
  await guest.reload();
  await guest.getByRole("button", { name: "Չեղարկել «Կանչել մատուցողին» հարցումը" }).click();
  await expect(mine).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: /հարցում սեղաններից/ })).toHaveCount(0);
});
