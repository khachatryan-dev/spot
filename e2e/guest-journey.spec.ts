import { expect, sql, test } from "./fixtures";
import { expectAccessible, seedMenu, setupActiveTable } from "./helpers";

/**
 * The guest's whole visit in one go (§42 "QR → Menu → Cart → Order → Order
 * Status", §56), on a phone, in Armenian, with accessibility checks on every
 * guest screen. Staff steps use the real dashboard.
 */
test("a guest's whole visit, from scanning to leaving", async ({ page, browser }) => {
  test.setTimeout(120_000); // many screens and two live-update waits in one test
  // --- Restaurant: active, table 1 with QR, a menu with options
  const { restaurantId, locationId, token } = await setupActiveTable(page, "Ամբողջական Ռեստորան");
  const { menuId, categoryId: pizzaCategory } = await seedMenu(restaurantId, locationId, "Պիցցա");
  const [drinks] = await sql`
    INSERT INTO menu_categories (restaurant_id, menu_id, name, sort_order)
    VALUES (${restaurantId}, ${menuId}, 'Ըմպելիքներ', 1) RETURNING id`;
  const [pizza] = await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, description, price_minor, allergens)
    VALUES (${restaurantId}, ${pizzaCategory}, 'Մարգարիտա', 'Լոլիկ, մոցարելլա, ռեհան', 350000, '{gluten,milk}') RETURNING id`;
  const [size] = await sql`
    INSERT INTO modifier_groups (restaurant_id, item_id, name, min_select, max_select, sort_order)
    VALUES (${restaurantId}, ${pizza!.id}, 'Չափս', 1, 1, 0) RETURNING id`;
  const [extras] = await sql`
    INSERT INTO modifier_groups (restaurant_id, item_id, name, min_select, max_select, sort_order)
    VALUES (${restaurantId}, ${pizza!.id}, 'Հավելումներ', 0, 2, 1) RETURNING id`;
  await sql`
    INSERT INTO modifiers (restaurant_id, group_id, name, price_delta_minor, is_default, sort_order) VALUES
      (${restaurantId}, ${size!.id}, 'Փոքր', 0, true, 0),
      (${restaurantId}, ${size!.id}, 'Մեծ', 50000, false, 1),
      (${restaurantId}, ${extras!.id}, 'Պանիր', 30000, false, 0)`;
  await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, price_minor, dietary_tags)
    VALUES (${restaurantId}, ${drinks!.id}, 'Թան', 60000, '{vegetarian}')`;

  // --- 1. Scan
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  await expect(guest).toHaveURL("/table");
  await expect(guest.getByRole("heading", { name: "Սեղան 1" })).toBeVisible();
  await expectAccessible(guest, "the table menu");
  await expect
    .poll(async () => {
      const [row] = await sql`
        SELECT count(*)::int AS n FROM analytics_events
        WHERE name = 'qr_scanned' AND restaurant_id = ${restaurantId} AND visitor_key IS NOT NULL`;
      return row!.n;
    })
    .toBe(1);

  // --- 2. Browse and choose
  const nav = guest.getByRole("navigation", { name: "Մենյուի բաժիններ" });
  await expect(nav.getByRole("link")).toHaveText(["Պիցցա", "Ըմպելիքներ"]);
  await guest.getByRole("article", { name: "Մարգարիտա" }).getByRole("button").click();
  const sheet = guest.getByRole("dialog", { name: "Մարգարիտա" });
  await expect(sheet).toContainText("Պարունակում է՝ Սնձան (գլյուտեն), Կաթ");
  await expectAccessible(guest, "the item sheet");
  await sheet.getByRole("radio", { name: /Մեծ/ }).check();
  await sheet.getByRole("checkbox", { name: /Պանիր/ }).check();
  await sheet.getByLabel("Նշում խոհանոցի համար").fill("լավ թխված");
  await sheet.getByRole("button", { name: "Ավելացնել", exact: true }).click();
  await sheet.getByRole("button", { name: "Ավելացնել · 8 600 ֏" }).click();
  await expect(sheet).toBeHidden();

  await nav.getByRole("link", { name: "Ըմպելիքներ" }).click();
  await guest.getByRole("article", { name: "Թան" }).getByRole("button").click();
  await guest
    .getByRole("dialog", { name: "Թան" })
    .getByRole("button", { name: /^Ավելացնել · / })
    .click();

  // --- 3. Cart: adjust and order
  await guest.getByRole("button", { name: /Դիտել պատվերը/ }).click();
  await expectAccessible(guest, "the cart");
  await guest.getByRole("button", { name: "Մեկով ավելի՝ Թան" }).click();
  await expect(guest.getByRole("dialog", { name: "Ձեր պատվերը" })).toContainText("Ընդամենը9 800 ֏");
  await guest.getByRole("button", { name: "Պատվիրել" }).click();

  // --- 4. My orders
  await expect(guest).toHaveURL(/\/table\/orders\?placed=/);
  const myOrder = guest.getByRole("list", { name: "Իմ պատվերները" }).getByRole("listitem").first();
  await expect(myOrder).toContainText("Պատվեր #1");
  await expect(myOrder).toContainText("Ուղարկված է ռեստորան");
  await expect(myOrder).toContainText("2 × Մարգարիտա · Մեծ, Պանիր");
  await expect(myOrder).toContainText("9 800 ֏");
  await expectAccessible(guest, "My orders");
  const [stored] = await sql`SELECT total_minor FROM orders WHERE restaurant_id = ${restaurantId}`;
  expect(stored!.total_minor).toBe(980000); // priced on the server

  // --- 5. Staff move it along; the guest's page follows by itself
  await page.goto(`/dashboard/r/${restaurantId}/kitchen`);
  const ticket = page.getByRole("article", { name: "Սեղան 1, պատվեր #1" });
  await expect(ticket).toContainText("լավ թխված");
  await ticket.getByRole("button", { name: "Ընդունել #1 պատվերը" }).click();
  await ticket.getByRole("button", { name: "Սկսել պատրաստել #1 պատվերը" }).click();
  await expect(myOrder).toContainText("Պատրաստվում է", { timeout: 25_000 });
  await ticket.getByRole("button", { name: "Պատրաստ է #1 պատվերը" }).click();

  await page.goto(`/dashboard/r/${restaurantId}/orders`);
  await page.getByRole("button", { name: "Մատուցված է #1 պատվերը" }).click();
  await expect(myOrder).toContainText("Մատուցված է", { timeout: 25_000 });

  // --- 6. The bill
  await guest.getByRole("link", { name: "Վերադառնալ մենյու" }).click();
  await guest
    .getByRole("region", { name: "Կանչել սպասարկում" })
    .getByRole("button", { name: "Հաշիվը", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Տեսա՝ սեղան 1, Հաշիվը" }).click();
  await expect(guest.getByRole("list", { name: "Ձեր հարցումները" })).toContainText("գալիս են", {
    timeout: 25_000,
  });
  await page.getByRole("button", { name: "Կատարված՝ սեղան 1, Հաշիվը" }).click();
  await page.getByRole("button", { name: "Ավարտել #1 պատվերը" }).click();
  await expect(page.getByRole("button", { name: "Ավարտել #1 պատվերը" })).toHaveCount(0);

  // --- 7. Staff close the visit; the guest is done
  await page.goto(`/dashboard/r/${restaurantId}/tables`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Փակել 1 սեղանի այցը" }).click();
  await expect(page.getByText("Այցը փակված է։ Սեղանն ազատ է։")).toBeVisible();
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "Սկանավորեք ձեր սեղանի QR կոդը" })).toBeVisible();
});
