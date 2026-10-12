import { expect, sql, test } from "./fixtures";
import { registerAndCreateRestaurant } from "./helpers";

async function activeRestaurantWithQr(page: import("@playwright/test").Page) {
  const restaurantId = await registerAndCreateRestaurant(page, "Այց Ռեստորան");
  await page.getByLabel("Մասնաճյուղի անվանումը").fill("Կենտրոն");
  await page.getByLabel("Հասցե").fill("Աբովյան 1");
  await page.getByRole("button", { name: "Ավելացնել մասնաճյուղ" }).click();
  await expect(page.getByText("Աբովյան 1, Երևան")).toBeVisible();
  await page.getByRole("link", { name: "Սեղաններ", exact: true }).click();
  await page.getByLabel("Մինչև").fill("1");
  await page.getByRole("button", { name: "Ավելացնել 1–1 սեղանները" }).click();
  await page.getByRole("button", { name: "Ստեղծել QR կոդեր" }).click();
  await expect(page.getByText("Բոլոր սեղաններն ունեն QR կոդ։")).toBeVisible();
  await sql`UPDATE restaurants SET status = 'active' WHERE id = ${restaurantId}`;
  const [row] =
    await sql`SELECT token FROM qr_tokens WHERE restaurant_id = ${restaurantId} AND revoked_at IS NULL`;
  return { restaurantId, token: row!.token as string };
}

test("staff see live visits and close them; guests can leave", async ({ page, browser }) => {
  const { token } = await activeRestaurantWithQr(page);

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  await expect(guest.getByRole("heading", { name: "Սեղան 1" })).toBeVisible();

  // Staff see the occupied table
  await page.reload();
  const row = page.getByRole("list", { name: "Սեղաններ" }).getByRole("listitem").first();
  const closeButton = page.getByRole("button", { name: "Փակել 1 սեղանի այցը" });
  await expect(closeButton).toBeVisible();
  await expect(row).toContainText("1 հյուր");

  // Staff close the visit → the guest loses access
  page.once("dialog", (d) => d.accept());
  await closeButton.click();
  await expect(page.getByText("Այցը փակված է։ Սեղանն ազատ է։")).toBeVisible();
  await expect(closeButton).toHaveCount(0);
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "Սկանավորեք ձեր սեղանի QR կոդը" })).toBeVisible();

  // Scanning again starts a new visit; the guest can leave it
  await guest.goto(`/t/${token}`);
  await expect(guest.getByRole("heading", { name: "Սեղան 1" })).toBeVisible();
  guest.once("dialog", (d) => d.accept());
  await guest.getByRole("button", { name: "Լքել սեղանը" }).click();
  await expect(guest.getByRole("heading", { name: "Սկանավորեք ձեր սեղանի QR կոդը" })).toBeVisible();
  await page.reload();
  await expect(row).toContainText("հյուր չկա");
});

test("hammering the scan link is rate limited", async ({ page, browser }) => {
  const { token } = await activeRestaurantWithQr(page);
  const context = await browser.newContext();
  // 60 scans per minute per IP are allowed; the 61st is refused.
  for (let i = 0; i < 60; i++) {
    const response = await context.request.get(`/t/${token}`, { maxRedirects: 0 });
    expect(response.headers().location).toMatch(/\/table$/);
  }
  const blocked = await context.request.get(`/t/${token}`, { maxRedirects: 0 });
  expect(blocked.headers().location).toMatch(/\/table\/unavailable\?reason=busy$/);

  const tab = await context.newPage();
  await tab.goto(`/t/${token}`);
  await expect(tab.getByRole("heading", { name: "Չափազանց շատ փորձեր" })).toBeVisible();
  await context.close();
});
