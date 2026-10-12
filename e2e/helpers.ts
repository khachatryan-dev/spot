import { expect, type Page } from "@playwright/test";

/** Register a fresh owner (Armenian UI) and create a draft restaurant; returns its id. */
export async function registerAndCreateRestaurant(page: Page, restaurantName: string) {
  await page.goto("/register");
  await page.getByLabel("Անուն").fill("Անի");
  await page
    .getByLabel("Էլ. փոստ")
    .fill(`owner-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.am`);
  await page.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/dashboard/new");
  await page.getByLabel("Ռեստորանի անվանումը").fill(restaurantName);
  await page.getByRole("button", { name: "Ստեղծել ռեստորան" }).click();
  await expect(page).toHaveURL(/\/dashboard\/r\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

/**
 * Owner sets up an active restaurant with one location and table 1 with a QR
 * code. Returns ids and the table's QR token. Uses `sql` for what the UI tests
 * elsewhere (activation by an admin).
 */
export async function setupActiveTable(page: Page, restaurantName: string) {
  const { sql } = await import("./fixtures");
  const restaurantId = await registerAndCreateRestaurant(page, restaurantName);
  await page.getByLabel("Մասնաճյուղի անվանումը").fill("Կենտրոն");
  await page.getByLabel("Հասցե").fill("Աբովյան 1");
  await page.getByRole("button", { name: "Ավելացնել մասնաճյուղ" }).click();
  await expect(page.getByText("Աբովյան 1, Երևան")).toBeVisible();
  await page.getByRole("link", { name: "Սեղաններ", exact: true }).click();
  await expect(page).toHaveURL(`/dashboard/r/${restaurantId}/tables`);
  const addRange = page.getByRole("button", { name: "Ավելացնել 1–1 սեղանները" });
  // A fill during the page's first render can be overwritten; retry until it sticks.
  await expect(async () => {
    await page.getByLabel("Մինչև").fill("1");
    await expect(addRange).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await addRange.click();
  await page.getByRole("button", { name: "Ստեղծել QR կոդեր" }).click();
  await expect(page.getByText("Բոլոր սեղաններն ունեն QR կոդ։")).toBeVisible();
  await sql`UPDATE restaurants SET status = 'active' WHERE id = ${restaurantId}`;
  const [qr] =
    await sql`SELECT token FROM qr_tokens WHERE restaurant_id = ${restaurantId} AND revoked_at IS NULL`;
  const [location] =
    await sql`SELECT id FROM restaurant_locations WHERE restaurant_id = ${restaurantId}`;
  return { restaurantId, locationId: location!.id as string, token: qr!.token as string };
}

/** Seed a menu with one category served at the location; returns ids for adding items. */
export async function seedMenu(restaurantId: string, locationId: string, categoryName: string) {
  const { sql } = await import("./fixtures");
  const [menu] =
    await sql`INSERT INTO menus (restaurant_id, name) VALUES (${restaurantId}, 'Հիմնական') RETURNING id`;
  await sql`INSERT INTO menu_locations (menu_id, location_id, restaurant_id) VALUES (${menu!.id}, ${locationId}, ${restaurantId})`;
  const [category] = await sql`
    INSERT INTO menu_categories (restaurant_id, menu_id, name) VALUES (${restaurantId}, ${menu!.id}, ${categoryName}) RETURNING id`;
  return { menuId: menu!.id as string, categoryId: category!.id as string };
}

/**
 * Accessibility check (§37): fails on serious or critical axe violations
 * (WCAG 2.1 A/AA rules) on the current page.
 */
export async function expectAccessible(page: Page, context: string) {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  // Measure the settled page, not a sheet or dialog halfway through fading in.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[role="dialog"]')].every(
        (d) => getComputedStyle(d).opacity === "1",
      ) && document.getAnimations().every((a) => a.playState !== "running"),
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  const summary = blocking.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} — ${v.nodes
        .slice(0, 3)
        .map((n) => `${n.target.join(" ")} [${n.failureSummary?.replace(/\s+/g, " ").trim()}]`)
        .join(" | ")}`,
  );
  expect(summary, `Accessibility problems on ${context}`).toEqual([]);
}

/** Tomorrow's date in Yerevan, as "YYYY-MM-DD". */
export function tomorrowInYerevan() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yerevan" }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

export async function seedBookableRestaurant() {
  const slug = `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const day = [{ open: "10:00", close: "22:00" }];
  const hours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
  const { sql } = await import("./fixtures");
  const [restaurant] = await sql`
    INSERT INTO restaurants (name, slug, status) VALUES ('Արարատ', ${slug}, 'active') RETURNING id`;
  const [location] = await sql`
    INSERT INTO restaurant_locations
      (restaurant_id, name, slug, address_line, city, opening_hours, reservations_enabled)
    VALUES (${restaurant!.id}, 'Կենտրոն', 'center', 'Աբովյան 1', 'Երևան', ${sql.json(hours)}, true)
    RETURNING id`;
  await sql`
    INSERT INTO tables (restaurant_id, location_id, number, capacity)
    VALUES (${restaurant!.id}, ${location!.id}, '1', 4)`;
  return { slug, restaurantId: restaurant!.id as string };
}
