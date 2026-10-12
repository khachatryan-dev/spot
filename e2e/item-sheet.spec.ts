import { expect, sql, test } from "./fixtures";
import { seedMenu, setupActiveTable } from "./helpers";

test("guest chooses options for an item with a live price", async ({ page, browser }) => {
  const { restaurantId, locationId, token } = await setupActiveTable(page, "Պիցցերիա");
  const { categoryId } = await seedMenu(restaurantId, locationId, "Պիցցա");
  const [pizza] = await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, price_minor, allergens)
    VALUES (${restaurantId}, ${categoryId}, 'Մարգարիտա', 350000, '{gluten,milk}') RETURNING id`;
  const [size] = await sql`
    INSERT INTO modifier_groups (restaurant_id, item_id, name, min_select, max_select, sort_order)
    VALUES (${restaurantId}, ${pizza!.id}, 'Չափս', 1, 1, 0) RETURNING id`;
  const [extras] = await sql`
    INSERT INTO modifier_groups (restaurant_id, item_id, name, min_select, max_select, sort_order)
    VALUES (${restaurantId}, ${pizza!.id}, 'Հավելումներ', 0, 2, 1) RETURNING id`;
  await sql`
    INSERT INTO modifiers (restaurant_id, group_id, name, price_delta_minor, is_default, is_available, sort_order) VALUES
      (${restaurantId}, ${size!.id}, 'Փոքր', 0, true, true, 0),
      (${restaurantId}, ${size!.id}, 'Մեծ', 50000, false, true, 1),
      (${restaurantId}, ${size!.id}, 'Հսկա', 90000, false, false, 2),
      (${restaurantId}, ${extras!.id}, 'Պանիր', 30000, false, true, 0),
      (${restaurantId}, ${extras!.id}, 'Խոզապուխտ', 40000, false, true, 1),
      (${restaurantId}, ${extras!.id}, 'Ձիթապտուղ', 20000, false, true, 2)`;

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  await guest.getByRole("article", { name: "Մարգարիտա" }).getByRole("button").click();

  const sheet = guest.getByRole("dialog", { name: "Մարգարիտա" });
  await expect(sheet).toContainText("Պարունակում է՝ Սնձան (գլյուտեն), Կաթ");
  await expect(sheet.getByRole("radio", { name: "Փոքր" })).toBeChecked(); // default
  await expect(sheet.getByRole("radio", { name: /Հսկա/ })).toBeDisabled(); // out of stock
  const add = sheet.getByRole("button", { name: /^Ավելացնել · / });
  await expect(add).toHaveText("Ավելացնել · 3 500 ֏");

  await sheet.getByRole("radio", { name: /Մեծ/ }).check();
  await expect(add).toHaveText("Ավելացնել · 4 000 ֏");

  // Extras: up to 2
  await sheet.getByRole("checkbox", { name: /Պանիր/ }).check();
  await sheet.getByRole("checkbox", { name: /Խոզապուխտ/ }).check();
  await sheet.getByRole("checkbox", { name: /Ձիթապտուղ/ }).click();
  await expect(sheet.getByRole("checkbox", { name: /Ձիթապտուղ/ })).not.toBeChecked();
  await expect(add).toHaveText("Ավելացնել · 4 700 ֏");

  // Quantity 2 → double
  await sheet.getByRole("button", { name: "Ավելացնել", exact: true }).click();
  await expect(sheet.getByRole("group", { name: "Քանակ" })).toContainText("2");
  await expect(add).toHaveText("Ավելացնել · 9 400 ֏");

  await sheet.getByLabel("Նշում խոհանոցի համար").fill("առանց սոխի");
  await add.click();
  await expect(guest.getByText("Մարգարիտա-ն ավելացված է։")).toBeVisible();
  await expect(sheet).toBeHidden();
});

test("a required choice without a default must be made before adding", async ({
  page,
  browser,
}) => {
  const { restaurantId, locationId, token } = await setupActiveTable(page, "Սրճարան");
  const { categoryId } = await seedMenu(restaurantId, locationId, "Սուրճ");
  const [coffee] = await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, price_minor)
    VALUES (${restaurantId}, ${categoryId}, 'Լատտե', 120000) RETURNING id`;
  const [milk] = await sql`
    INSERT INTO modifier_groups (restaurant_id, item_id, name, min_select, max_select)
    VALUES (${restaurantId}, ${coffee!.id}, 'Կաթ', 1, 1) RETURNING id`;
  await sql`
    INSERT INTO modifiers (restaurant_id, group_id, name, price_delta_minor, sort_order) VALUES
      (${restaurantId}, ${milk!.id}, 'Կովի', 0, 0),
      (${restaurantId}, ${milk!.id}, 'Վարսակի', 20000, 1)`;

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  await guest.getByRole("article", { name: "Լատտե" }).getByRole("button").click();
  const sheet = guest.getByRole("dialog", { name: "Լատտե" });
  const add = sheet.getByRole("button", { name: "Ընտրեք պարտադիր ընտրանքները" });
  await expect(add).toBeDisabled();
  await sheet.getByRole("radio", { name: /Վարսակի/ }).check();
  await expect(sheet.getByRole("button", { name: "Ավելացնել · 1 400 ֏" })).toBeEnabled();
});
