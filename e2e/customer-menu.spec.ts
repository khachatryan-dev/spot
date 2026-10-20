import { expect, sql, test } from "./fixtures";
import { registerAndCreateRestaurant } from "./helpers";

test("guest sees the menu after scanning", async ({ page, browser }) => {
  // Owner: location, table 1 with QR, active restaurant
  const restaurantId = await registerAndCreateRestaurant(page, "Ճաշակ");
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
  const [qr] =
    await sql`SELECT token FROM qr_tokens WHERE restaurant_id = ${restaurantId} AND revoked_at IS NULL`;
  const [location] =
    await sql`SELECT id FROM restaurant_locations WHERE restaurant_id = ${restaurantId}`;

  // Menu (seeded directly; the editor is covered by other tests)
  const [menu] =
    await sql`INSERT INTO menus (restaurant_id, name) VALUES (${restaurantId}, 'Հիմնական') RETURNING id`;
  await sql`INSERT INTO menu_locations (menu_id, location_id, restaurant_id) VALUES (${menu!.id}, ${location!.id}, ${restaurantId})`;
  const [salads] =
    await sql`INSERT INTO menu_categories (restaurant_id, menu_id, name, sort_order) VALUES (${restaurantId}, ${menu!.id}, 'Աղցաններ', 0) RETURNING id`;
  const [soups] =
    await sql`INSERT INTO menu_categories (restaurant_id, menu_id, name, sort_order) VALUES (${restaurantId}, ${menu!.id}, 'Ապուրներ', 1) RETURNING id`;
  await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, description, price_minor, allergens, dietary_tags, translations)
    VALUES
      (${restaurantId}, ${salads!.id}, 'Կեսար', 'Հավ, մարուլ, պարմեզան', 350000, '{eggs,milk}', '{}', '{"en":{"name":"Caesar salad"}}'),
      (${restaurantId}, ${salads!.id}, 'Բանջարեղենային', NULL, 220000, '{}', '{vegan}', '{}'),
      (${restaurantId}, ${soups!.id}, 'Խաշ', NULL, 400000, '{}', '{}', '{}')`;
  await sql`UPDATE menu_items SET is_available = false WHERE restaurant_id = ${restaurantId} AND name = 'Խաշ'`;
  await sql`INSERT INTO menu_items (restaurant_id, category_id, name, price_minor, is_active) VALUES (${restaurantId}, ${soups!.id}, 'Թաքնված', 100, false)`;

  // Guest scans
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${qr!.token}`);
  await expect(guest.getByRole("heading", { name: "Սեղան 1" })).toBeVisible();

  const nav = guest.getByRole("navigation", { name: "Մենյուի բաժիններ" });
  await expect(nav.getByRole("link")).toHaveText(["Աղցաններ", "Ապուրներ"]);

  const caesar = guest.getByRole("article", { name: "Կեսար" });
  await expect(caesar).toContainText("3 500 ֏");
  await expect(caesar).toContainText("Պարունակում է՝ Ձու, Կաթ");
  await expect(caesar).toContainText("Հավ, մարուլ, պարմեզան");
  await expect(guest.getByRole("article", { name: "Բանջարեղենային" })).toContainText("Վեգան");
  await expect(guest.getByRole("article", { name: "Խաշ" })).toContainText("Առկա չէ");
  await expect(guest.getByText("Թաքնված")).toHaveCount(0);

  // Category chip jumps to its section
  await nav.getByRole("link", { name: "Ապուրներ" }).click();
  await expect(guest).toHaveURL(/#cat-/);
  await expect(guest.getByRole("heading", { name: "Ապուրներ" })).toBeInViewport();

  // English guest gets the translated name
  const tourist = await (await browser.newContext({ locale: "en-US" })).newPage();
  await tourist.goto(`/t/${qr!.token}`);
  await expect(tourist.getByRole("article", { name: "Caesar salad" })).toContainText("3,500 ֏");

  // When the location is closed, guests get a clear message
  await sql`UPDATE restaurant_locations SET opening_hours = '{"mon":[{"open":"00:00","close":"00:01"}]}'::jsonb WHERE id = ${location!.id}`;
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "Մենյուն այս պահին հասանելի չէ" })).toBeVisible();
});

test("without a table, the page explains how to start and where to look", async ({ page }) => {
  await page.goto("/table");
  await expect(
    page.getByRole("heading", { level: 1, name: "Սկանավորեք ձեր սեղանի QR կոդը" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Գտնել ռեստորան" }).click();
  await expect(page).toHaveURL("/restaurants");
});
