import { expect, sql, test } from "./fixtures";
import { seedMenu, setupActiveTable } from "./helpers";

test("guest builds a cart that follows today's menu", async ({ page, browser }) => {
  const { restaurantId, locationId, token } = await setupActiveTable(page, "Զամբյուղ");
  const { categoryId } = await seedMenu(restaurantId, locationId, "Ուտեստներ");
  await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, price_minor, sort_order) VALUES
      (${restaurantId}, ${categoryId}, 'Տոլմա', 280000, 0),
      (${restaurantId}, ${categoryId}, 'Լավաշ', 30000, 1)`;

  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(`/t/${token}`);

  const addItem = async (name: string) => {
    await guest.getByRole("article", { name }).getByRole("button").click();
    await guest
      .getByRole("dialog", { name })
      .getByRole("button", { name: /^Ավելացնել · / })
      .click();
    await expect(guest.getByRole("dialog", { name })).toBeHidden();
  };

  await expect(guest.getByRole("button", { name: /Դիտել պատվերը/ })).toHaveCount(0); // empty cart: no bar
  await addItem("Տոլմա");
  await addItem("Լավաշ");
  await addItem("Լավաշ"); // same choice → merged
  const bar = guest.getByRole("button", { name: /Դիտել պատվերը/ });
  await expect(bar).toContainText("3");
  await expect(bar).toContainText("3 400 ֏");

  // Cart sheet: quantities and removal
  await bar.click();
  const cart = guest.getByRole("list", { name: "Ձեր պատվերը" });
  await expect(cart.getByRole("listitem")).toHaveCount(2);
  await expect(cart.getByRole("listitem").nth(1)).toContainText("600 ֏");
  await guest.getByRole("button", { name: "Մեկով ավելի՝ Տոլմա" }).click();
  await expect(guest.getByRole("dialog")).toContainText("6 200 ֏");
  await guest.getByRole("button", { name: "Հեռացնել Լավաշ-ը" }).click();
  await expect(cart.getByRole("listitem")).toHaveCount(1);
  await expect(guest.getByRole("button", { name: "Պատվիրել" })).toBeEnabled();
  await guest.keyboard.press("Escape");

  // A reload keeps the cart
  await guest.reload();
  await expect(bar).toContainText("5 600 ֏");

  // The item runs out after it was added: flagged, not counted
  await sql`UPDATE menu_items SET is_available = false WHERE restaurant_id = ${restaurantId} AND name = 'Տոլմա'`;
  await guest.reload();
  await bar.click();
  await expect(cart.getByRole("listitem").first()).toContainText("Այլևս հասանելի չէ");
  await expect(guest.getByText("Հեռացրեք այլևս անհասանելի ուտեստները։")).toBeVisible();
  await expect(guest.getByRole("dialog")).toContainText("Ընդամենը0 ֏");

  // A new visit at the table starts with an empty cart
  await sql`UPDATE table_sessions SET status = 'closed', closed_at = now(), closed_reason = 'staff' WHERE restaurant_id = ${restaurantId}`;
  await guest.goto(`/t/${token}`);
  await expect(guest.getByRole("heading", { name: "Սեղան 1" })).toBeVisible();
  await expect(guest.getByRole("button", { name: /Դիտել պատվերը/ })).toHaveCount(0);
  await context.close();
});
