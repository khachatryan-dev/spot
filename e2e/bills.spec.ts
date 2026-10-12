import { expect, sql, test } from "./fixtures";
import { expectAccessible, seedMenu, setupActiveTable } from "./helpers";

/** §22: the bill follows the orders, is finalized by staff, and can be voided to correct it. */
test("guests see a running bill; staff finalize it with service and VAT, or void it", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const { restaurantId, locationId, token } = await setupActiveTable(page, "Հաշվի Ռեստորան");
  const { categoryId } = await seedMenu(restaurantId, locationId, "Ըմպելիքներ");
  await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, price_minor)
    VALUES (${restaurantId}, ${categoryId}, 'Սուրճ', 120000)`;

  // The owner sets a 10 % service charge and marks the restaurant as a VAT payer.
  await page.goto(`/dashboard/r/${restaurantId}/locations/${locationId}`);
  await page.getByLabel("Սպասարկման վճար").selectOption("1000");
  await page.getByRole("button", { name: "Պահպանել մասնաճյուղը" }).click();
  await expect(page.getByText("Մասնաճյուղը պահպանված է։")).toBeVisible();
  await page.goto(`/dashboard/r/${restaurantId}/profile`);
  await page.getByLabel(/ԱԱՀ վճարող/).check();
  await page.getByRole("button", { name: "Պահպանել փոփոխությունները" }).click();
  await expect(page.getByText("Պրոֆիլը պահպանված է։")).toBeVisible();

  // The guest orders two coffees.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  const order = async (quantity: number) => {
    await guest.getByRole("article", { name: "Սուրճ" }).getByRole("button").click();
    const sheet = guest.getByRole("dialog", { name: "Սուրճ" });
    for (let i = 1; i < quantity; i++) {
      await sheet.getByRole("button", { name: "Ավելացնել", exact: true }).click();
    }
    await sheet.getByRole("button", { name: /^Ավելացնել · / }).click();
    await guest.getByRole("button", { name: /Դիտել պատվերը/ }).click();
    await guest.getByRole("button", { name: "Պատվիրել" }).click();
  };
  await order(2);
  await expect(guest).toHaveURL(/\/table\/orders\?placed=/);

  await guest.goto("/table");
  await guest.getByRole("link", { name: "Հաշիվ", exact: true }).click();
  await expect(
    guest.getByText("Այս սեղանի պատվերների ընթացիկ գումարը։", { exact: false }),
  ).toBeVisible();
  const bill = guest.getByRole("region", { name: "Հաշիվ" });
  await expect(bill).toContainText("2 × Սուրճ");
  await expect(bill).toContainText(/Սպասարկում 10 %\s*240.֏/);
  await expect(bill).toContainText(/Ընդամենը\s*2.640.֏/);
  await expect(bill).toContainText(/Ներառյալ ԱԱՀ 20 %\s*440.֏/);
  await expectAccessible(guest, "guest bill");

  // Staff: the kitchen answers first, then the bill is finalized from the tables page.
  await page.goto(`/dashboard/r/${restaurantId}/tables`);
  await page.getByRole("link", { name: "1 սեղանի հաշիվը" }).click();
  await expect(page.getByRole("heading", { name: "Հաշիվ · սեղան 1" })).toBeVisible();
  await expect(page.getByText(/Խոհանոցի պատասխանին սպասող պատվերներ՝ 1/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ավարտել հաշիվը" })).toHaveCount(0);
  await expectAccessible(page, "staff bill");

  await page.goto(`/dashboard/r/${restaurantId}/kitchen`);
  await page.getByRole("button", { name: "Ընդունել #1 պատվերը" }).click();
  await expect(page.getByRole("button", { name: "Ընդունել #1 պատվերը" })).toHaveCount(0);
  await page.goBack();
  await page.reload();
  await page.getByRole("button", { name: "Ավարտել հաշիվը" }).click();
  await expect(page.getByText("Հաշիվն ավարտված է։")).toBeVisible();
  await expect(page.getByRole("region", { name: "Հաշիվ" })).toContainText("Պատրաստ է վճարման");

  // The guest sees the final bill, and can't add to it any more.
  await guest.reload();
  await expect(guest.getByText("Ձեր հաշիվը պատրաստ է։")).toBeVisible();
  await guest.goto("/table");
  await order(1);
  await expect(guest.getByText("Այս պահին պատվերը հնարավոր չէ կատարել։")).toBeVisible();
  expect(await sql`SELECT id FROM orders WHERE restaurant_id = ${restaurantId}`).toHaveLength(1);

  // Correcting it: void (with a reason), and the table gets a fresh bill.
  await page.getByRole("button", { name: "Չեղարկել հաշիվը" }).click();
  const dialog = page.getByRole("dialog", { name: "Չեղարկե՞լ 1 սեղանի հաշիվը" });
  await dialog.getByLabel("Պատճառ").fill("Սխալ սեղան");
  await dialog.getByRole("button", { name: "Չեղարկել հաշիվը" }).click();
  await expect(page.getByText("Հաշիվը չեղարկված է։")).toBeVisible();
  await expect(page.getByRole("region", { name: "Հաշիվ" })).toContainText("Ընթացիկ");
  const statuses =
    await sql`SELECT status FROM bills WHERE restaurant_id = ${restaurantId} ORDER BY created_at`;
  expect(statuses.map((b) => b.status)).toEqual(["void", "open"]);
});

/** §23: guests pay their own items, a friend's items, and staff take the rest in cash. */
test("guests split by items: own, a friend's, and cash for the rest", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const { restaurantId, locationId, token } = await setupActiveTable(page, "Բաժանման Ռեստորան");
  const { categoryId } = await seedMenu(restaurantId, locationId, "Ըմպելիքներ");
  await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, price_minor)
    VALUES (${restaurantId}, ${categoryId}, 'Սուրճ', 120000), (${restaurantId}, ${categoryId}, 'Թեյ', 80000)`;

  const seat = async () => {
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/t/${token}`);
    return guest;
  };
  const order = async (guest: Awaited<ReturnType<typeof seat>>, item: string) => {
    await guest.goto("/table");
    await guest.getByRole("article", { name: item }).getByRole("button").click();
    await guest
      .getByRole("dialog", { name: item })
      .getByRole("button", { name: /^Ավելացնել · / })
      .click();
    await guest.getByRole("button", { name: /Դիտել պատվերը/ }).click();
    await guest.getByRole("button", { name: "Պատվիրել" }).click();
    await expect(guest).toHaveURL(/\/table\/orders\?placed=/);
  };
  const anna = await seat();
  const gor = await seat();
  await order(anna, "Սուրճ"); // 1 200 ֏
  await order(gor, "Թեյ"); // 800 ֏
  await order(gor, "Սուրճ"); // 1 200 ֏

  // Staff accept the orders and finalize the bill (3 200 ֏).
  await page.goto(`/dashboard/r/${restaurantId}/kitchen`);
  for (const n of [1, 2, 3]) {
    await page.getByRole("button", { name: `Ընդունել #${n} պատվերը` }).click();
    await expect(page.getByRole("button", { name: `Ընդունել #${n} պատվերը` })).toHaveCount(0);
  }
  await page.goto(`/dashboard/r/${restaurantId}/tables`);
  await page.getByRole("link", { name: "1 սեղանի հաշիվը" }).click();
  await page.getByRole("button", { name: "Ավարտել հաշիվը" }).click();
  await expect(page.getByText("Հաշիվն ավարտված է։")).toBeVisible();

  // Anna's own coffee is pre-selected; she pays it online.
  await anna.goto("/table/bill");
  await expect(anna.getByRole("heading", { name: /Մնացել է վճարել՝ 3.200.֏/ })).toBeVisible();
  await expectAccessible(anna, "guest bill with payment options");
  await anna.getByRole("button", { name: /Վճարել ընտրվածը · 1.200.֏/ }).click();
  await expect(anna).toHaveURL(/\/dev\/pay\/fake_/);
  await anna.getByRole("button", { name: "Վճարել" }).click();
  await expect(anna).toHaveURL(/\/table\/bill$/);
  await expect(anna.getByRole("heading", { name: /Մնացել է վճարել՝ 2.000.֏/ })).toBeVisible();

  // Gor's card is declined.
  await gor.goto("/table/bill");
  await gor.getByRole("button", { name: /Վճարել ընտրվածը · 2.000.֏/ }).click();
  await gor.getByRole("button", { name: "Մերժել" }).click();
  await expect(gor.getByRole("heading", { name: /Մնացել է վճարել՝ 2.000.֏/ })).toBeVisible();

  // Anna pays for Gor's tea.
  await anna.reload();
  await expect(anna.getByRole("checkbox", { name: /Սուրճ/ })).not.toBeChecked();
  await anna.getByRole("checkbox", { name: /Թեյ/ }).check();
  await anna.getByRole("button", { name: /Վճարել ընտրվածը · 800.֏/ }).click();
  await expect(anna).toHaveURL(/\/dev\/pay\/fake_/);
  await anna.getByRole("button", { name: "Վճարել", exact: true }).click();
  await expect(anna.getByRole("heading", { name: /Մնացել է վճարել՝ 1.200.֏/ })).toBeVisible();

  // Gor pays his coffee in cash; staff record it by picking the line.
  await page.reload();
  await page.getByLabel("Եղանակ").selectOption("cash");
  await page.getByRole("checkbox", { name: /Սուրճ/ }).check();
  await page.getByRole("button", { name: /Ընտրվածը · 1.200.֏/ }).click();
  await expect(page.getByText("Վճարումը գրանցված է։")).toBeVisible();
  await expect(page.getByRole("region", { name: "Հաշիվ" })).toContainText("Վճարված");
  await expectAccessible(page, "staff bill with payments");

  await gor.reload();
  await expect(gor.getByText("Հաշիվը վճարված է։ Շնորհակալություն։")).toBeVisible();
  const [bill] =
    await sql`SELECT status, paid_minor FROM bills WHERE restaurant_id = ${restaurantId}`;
  expect(bill).toEqual({ status: "paid", paid_minor: 320000 });
  const methods = await sql`
    SELECT method, amount_minor FROM bill_payments
    WHERE restaurant_id = ${restaurantId} AND status = 'succeeded' ORDER BY created_at`;
  expect(methods.map((m) => [m.method, m.amount_minor])).toEqual([
    ["online", 120000],
    ["online", 80000],
    ["cash", 120000],
  ]);
});
