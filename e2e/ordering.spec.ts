import { expect, sql, test } from "./fixtures";
import { seedMenu, setupActiveTable } from "./helpers";

test("guest places an order and follows it", async ({ page, browser }) => {
  const { restaurantId, locationId, token } = await setupActiveTable(page, "Պատվեր Ռեստորան");
  const { categoryId } = await seedMenu(restaurantId, locationId, "Ուտեստներ");
  await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, price_minor, sort_order) VALUES
      (${restaurantId}, ${categoryId}, 'Տոլմա', 280000, 0),
      (${restaurantId}, ${categoryId}, 'Լավաշ', 30000, 1)`;

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  const add = async (name: string) => {
    await guest.getByRole("article", { name }).getByRole("button").click();
    const sheet = guest.getByRole("dialog", { name });
    if (name === "Տոլմա") await sheet.getByLabel("Նշում խոհանոցի համար").fill("առանց սխտորի");
    await sheet.getByRole("button", { name: /^Ավելացնել · / }).click();
    await expect(sheet).toBeHidden();
  };
  await add("Տոլմա");
  await add("Լավաշ");

  // Place the order — a double tap must not create two orders
  await guest.getByRole("button", { name: /Դիտել պատվերը/ }).click();
  const place = guest.getByRole("button", { name: "Պատվիրել" });
  await place.dblclick();
  await expect(guest).toHaveURL(/\/table\/orders\?placed=/);
  await expect(guest.getByText("Պատվերն ուղարկված է։ Ռեստորանն այն ստացել է։")).toBeVisible();

  const order = guest.getByRole("list", { name: "Իմ պատվերները" }).getByRole("listitem").first();
  await expect(order).toContainText("Պատվեր #1");
  await expect(order).toContainText("Ուղարկված է ռեստորան");
  await expect(order).toContainText("1 × Տոլմա");
  await expect(order).toContainText("առանց սխտորի");
  await expect(order).toContainText("3 100 ֏");

  const rows =
    await sql`SELECT number, total_minor FROM orders WHERE restaurant_id = ${restaurantId}`;
  expect(rows).toEqual([{ number: 1, total_minor: 310000 }]);

  // Cart is empty; the table page links to the orders
  await guest.getByRole("link", { name: "Վերադառնալ մենյու" }).click();
  await expect(guest.getByRole("button", { name: /Դիտել պատվերը/ })).toHaveCount(0);
  await expect(guest.getByRole("link", { name: "Իմ պատվերները (1)" })).toBeVisible();

  // Status changes show up (the page refreshes itself; reload to skip the wait)
  await sql`UPDATE orders SET status = 'preparing' WHERE restaurant_id = ${restaurantId}`;
  await guest.getByRole("link", { name: "Իմ պատվերները (1)" }).click();
  await expect(order).toContainText("Պատրաստվում է");
});

test("an item that runs out before ordering is pointed out, and nothing is ordered", async ({
  page,
  browser,
}) => {
  const { restaurantId, locationId, token } = await setupActiveTable(page, "Վերջացավ Ռեստորան");
  const { categoryId } = await seedMenu(restaurantId, locationId, "Ուտեստներ");
  await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, price_minor, sort_order) VALUES
      (${restaurantId}, ${categoryId}, 'Խորոված', 450000, 0),
      (${restaurantId}, ${categoryId}, 'Թան', 50000, 1)`;

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  for (const name of ["Խորոված", "Թան"]) {
    await guest.getByRole("article", { name }).getByRole("button").click();
    await guest
      .getByRole("dialog", { name })
      .getByRole("button", { name: /^Ավելացնել · / })
      .click();
    await expect(guest.getByRole("dialog", { name })).toBeHidden();
  }
  await guest.getByRole("button", { name: /Դիտել պատվերը/ }).click();

  // Meanwhile the kitchen runs out of barbecue
  await sql`UPDATE menu_items SET is_available = false WHERE restaurant_id = ${restaurantId} AND name = 'Խորոված'`;
  await guest.getByRole("button", { name: "Պատվիրել" }).click();
  await expect(
    guest.getByText("Որոշ ուտեստներ փոխվել են։ Խնդրում ենք ստուգել պատվերը։"),
  ).toBeVisible();
  await expect(
    guest.getByRole("list", { name: "Ձեր պատվերը" }).getByRole("listitem").first(),
  ).toContainText(/Հենց նոր վերջացավ|Այլևս հասանելի չէ/);
  expect(await sql`SELECT id FROM orders WHERE restaurant_id = ${restaurantId}`).toHaveLength(0);

  // Remove it and order the rest
  await guest.getByRole("button", { name: "Հեռացնել Խորոված-ը" }).click();
  await guest.getByRole("button", { name: "Պատվիրել" }).click();
  await expect(guest).toHaveURL(/\/table\/orders\?placed=/);
  await expect(guest.getByRole("list", { name: "Իմ պատվերները" })).toContainText("1 × Թան");
});
