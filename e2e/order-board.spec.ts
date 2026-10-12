import { type Browser, expect, type Page, sql, test } from "./fixtures";
import { seedMenu, setupActiveTable } from "./helpers";

/** Owner sets up a table with "Քյաբաբ" on the menu; a guest orders it. Returns both pages. */
async function guestOrders(page: Page, browser: Browser, restaurantName: string) {
  const { restaurantId, locationId, token } = await setupActiveTable(page, restaurantName);
  const { categoryId } = await seedMenu(restaurantId, locationId, "Ուտեստներ");
  await sql`INSERT INTO menu_items (restaurant_id, category_id, name, price_minor) VALUES (${restaurantId}, ${categoryId}, 'Քյաբաբ', 300000)`;
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  await guest.getByRole("article", { name: "Քյաբաբ" }).getByRole("button").click();
  const sheet = guest.getByRole("dialog", { name: "Քյաբաբ" });
  await sheet.getByLabel("Նշում խոհանոցի համար").fill("առանց սոխի");
  await sheet.getByRole("button", { name: "Ավելացնել", exact: true }).click(); // quantity 2
  await sheet.getByRole("button", { name: /^Ավելացնել · / }).click();
  await guest.getByRole("button", { name: /Դիտել պատվերը/ }).click();
  await guest.getByRole("button", { name: "Պատվիրել" }).click();
  await expect(guest).toHaveURL(/\/table\/orders/);
  await page.goto(`/dashboard/r/${restaurantId}/orders`);
  return { restaurantId, guest };
}

test("staff move an order through the board", async ({ page, browser }) => {
  const { guest } = await guestOrders(page, browser, "Տախտակ Ռեստորան");
  const card = page.getByRole("article", { name: "Պատվեր #1, սեղան 1" });
  const inColumn = (name: string) => page.getByRole("list", { name }).getByRole("article");

  await expect(inColumn("Նոր")).toHaveCount(1);
  await expect(card).toContainText("2 × Քյաբաբ");
  await expect(card).toContainText("առանց սոխի");
  await expect(card).toContainText("6 000 ֏");

  await card.getByRole("button", { name: "Ընդունել #1 պատվերը" }).click();
  await expect(inColumn("Ընթացքում")).toHaveCount(1);
  await card.getByRole("button", { name: "Սկսել պատրաստել #1 պատվերը" }).click();
  await expect(card).toContainText("Պատրաստվում է");
  await card.getByRole("button", { name: "Պատրաստ է #1 պատվերը" }).click();
  await expect(inColumn("Պատրաստ")).toHaveCount(1);
  await card.getByRole("button", { name: "Մատուցված է #1 պատվերը" }).click();
  await expect(inColumn("Մատուցված")).toHaveCount(1);

  // The guest sees the progress
  await guest.reload();
  await expect(guest.getByRole("list", { name: "Իմ պատվերները" })).toContainText("Մատուցված է");

  await card.getByRole("button", { name: "Ավարտել #1 պատվերը" }).click();
  await expect(
    page.getByText("Բաց պատվերներ այս պահին չկան։ Նորերն ավտոմատ կհայտնվեն։"),
  ).toBeVisible();
  await page.getByText("Այսօր ավարտված՝ 1 պատվեր").click();
  await expect(page.getByText(/#1 · Սեղան 1/)).toBeVisible();
});

test("a rejected order shows the reason to the guest", async ({ page, browser }) => {
  const { guest } = await guestOrders(page, browser, "Մերժում Ռեստորան");
  const card = page.getByRole("article", { name: "Պատվեր #1, սեղան 1" });
  await card.getByRole("button", { name: "Մերժել #1 պատվերը" }).click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Մերժել" });
  await expect(confirm).toBeDisabled(); // reason required
  await dialog.getByLabel("Պատճառը").fill("Քյաբաբն այսօր վերջացել է");
  await confirm.click();
  await expect(
    page.getByText("Բաց պատվերներ այս պահին չկան։ Նորերն ավտոմատ կհայտնվեն։"),
  ).toBeVisible();

  await guest.reload();
  const order = guest.getByRole("list", { name: "Իմ պատվերները" });
  await expect(order).toContainText("Մերժված է");
  await expect(order).toContainText("Պատճառը՝ Քյաբաբն այսօր վերջացել է");
});

test("a guest can cancel only until the kitchen accepts", async ({ page, browser }) => {
  const { restaurantId, guest } = await guestOrders(page, browser, "Չեղարկում Ռեստորան");
  guest.once("dialog", (d) => d.accept());
  await guest.getByRole("button", { name: "Չեղարկել պատվերը" }).click();
  await expect(guest.getByRole("list", { name: "Իմ պատվերները" })).toContainText("Չեղարկված է");
  await expect(guest.getByRole("button", { name: "Չեղարկել պատվերը" })).toHaveCount(0);
  const [row] =
    await sql`SELECT status, cancel_reason FROM orders WHERE restaurant_id = ${restaurantId}`;
  expect(row).toEqual({ status: "cancelled", cancel_reason: "Cancelled by the guest" });
});
