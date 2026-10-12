import { expect, sql, test } from "./fixtures";
import { seedMenu, setupActiveTable } from "./helpers";

test("the order board updates by itself when a guest orders (no reload)", async ({
  page,
  browser,
}) => {
  const { restaurantId, locationId, token } = await setupActiveTable(page, "Կենդանի Ռեստորան");
  const { categoryId } = await seedMenu(restaurantId, locationId, "Ուտեստներ");
  await sql`INSERT INTO menu_items (restaurant_id, category_id, name, price_minor) VALUES (${restaurantId}, ${categoryId}, 'Ժենգյալով հաց', 150000)`;

  // Staff open the board first
  await page.goto(`/dashboard/r/${restaurantId}/orders`);
  await expect(
    page.getByText("Բաց պատվերներ այս պահին չկան։ Նորերն ավտոմատ կհայտնվեն։"),
  ).toBeVisible();

  // A guest orders
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  await guest.getByRole("article", { name: "Ժենգյալով հաց" }).getByRole("button").click();
  await guest
    .getByRole("dialog", { name: "Ժենգյալով հաց" })
    .getByRole("button", { name: /^Ավելացնել · / })
    .click();
  await guest.getByRole("button", { name: /Դիտել պատվերը/ }).click();
  await guest.getByRole("button", { name: "Պատվիրել" }).click();
  await expect(guest).toHaveURL(/\/table\/orders/);

  // Without Ably configured, the board falls back to polling — the card appears on its own
  await expect(page.getByRole("article", { name: "Պատվեր #1, սեղան 1" })).toBeVisible({
    timeout: 20_000,
  });

  // And the guest's page follows status changes on its own too
  await page.getByRole("button", { name: "Ընդունել #1 պատվերը" }).click();
  await expect(guest.getByRole("list", { name: "Իմ պատվերները" })).toContainText("Ընդունված է", {
    timeout: 25_000,
  });
});

test("realtime tokens are refused when realtime isn't configured", async ({ request }) => {
  const response = await request.post("/api/realtime/token", {
    data: { channel: "session:00000000-0000-4000-8000-000000000000" },
    headers: { origin: "http://localhost:3210" },
  });
  const body = await response.json();
  expect(body.error.code).toBe("RESOURCE_UNAVAILABLE");
});
