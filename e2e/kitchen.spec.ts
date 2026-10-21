import { expect, type Page, sql, test } from "./fixtures";
import { seedMenu, setupActiveTable } from "./helpers";

async function staffMember(
  browser: import("@playwright/test").Browser,
  restaurantId: string,
  role: "kitchen" | "waiter",
) {
  const email = `${role}-${Date.now()}@example.am`;
  const page: Page = await (await browser.newContext()).newPage();
  await page.goto("/register");
  await page.getByLabel("Անուն").fill(role);
  await page.getByLabel("Էլ. փոստ").fill(email);
  await page.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL("/home");
  await sql`INSERT INTO restaurant_staff (restaurant_id, user_id, role) SELECT ${restaurantId}, id, ${role} FROM users WHERE email = ${email}`;
  return page;
}

test("the kitchen prepares orders on its own screen, without prices", async ({ page, browser }) => {
  const { restaurantId, locationId, token } = await setupActiveTable(page, "Խոհանոցի Ռեստորան");
  const { categoryId } = await seedMenu(restaurantId, locationId, "Ուտեստներ");
  await sql`INSERT INTO menu_items (restaurant_id, category_id, name, price_minor) VALUES (${restaurantId}, ${categoryId}, 'Ղապամա', 520000)`;

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  await guest.getByRole("article", { name: "Ղապամա" }).getByRole("button").click();
  await guest
    .getByRole("dialog", { name: "Ղապամա" })
    .getByLabel("Նշում խոհանոցի համար")
    .fill("առանց չամիչի");
  await guest
    .getByRole("dialog", { name: "Ղապամա" })
    .getByRole("button", { name: /^Ավելացնել · / })
    .click();
  await guest.getByRole("button", { name: /Դիտել պատվերը/ }).click();
  await guest.getByRole("button", { name: "Պատվիրել" }).click();
  await expect(guest).toHaveURL(/\/table\/orders/);

  const cook = await staffMember(browser, restaurantId, "kitchen");
  await cook.goto(`/dashboard/r/${restaurantId}`);
  await cook
    .getByRole("navigation", { name: "Ռեստորանի բաժիններ" })
    .getByRole("link", { name: "Խոհանոց" })
    .click();

  const ticket = cook.getByRole("article", { name: "Սեղան 1, պատվեր #1" });
  await expect(ticket).toContainText("1 × Ղապամա");
  await expect(ticket).toContainText("առանց չամիչի");
  await expect(cook.getByRole("list", { name: "Պատրաստելու պատվերներ" })).not.toContainText("֏");

  // An order waiting too long is flagged (not by colour alone)
  await sql`UPDATE orders SET submitted_at = now() - interval '25 minutes' WHERE restaurant_id = ${restaurantId}`;
  await cook.reload();
  await expect(ticket).toContainText("Շատ երկար է սպասում");

  await ticket.getByRole("button", { name: "Ընդունել #1 պատվերը" }).click();
  await expect(ticket).toContainText("Ընդունված");
  await ticket.getByRole("button", { name: "Սկսել պատրաստել #1 պատվերը" }).click();
  await expect(ticket).toContainText("Պատրաստվում է");
  await expect(ticket.getByRole("button", { name: /Մատուցված է/ })).toHaveCount(0); // not the kitchen's job
  await ticket.getByRole("button", { name: "Պատրաստ է #1 պատվերը" }).click();

  await expect(cook.getByText("Ամեն ինչ պատրաստ է․ պատրաստելու պատվերներ չկան։")).toBeVisible();
  await expect(cook.getByRole("list", { name: "Պատրաստ է, սպասում է մատուցողին" })).toContainText(
    "Սեղան 1 · #1",
  );

  // Waiters don't get the kitchen screen
  const waiter = await staffMember(browser, restaurantId, "waiter");
  await waiter.goto(`/dashboard/r/${restaurantId}`);
  await expect(
    waiter
      .getByRole("navigation", { name: "Ռեստորանի բաժիններ" })
      .getByRole("link", { name: "Խոհանոց" }),
  ).toHaveCount(0);
  expect((await waiter.goto(`/dashboard/r/${restaurantId}/kitchen`))?.status()).toBe(404);
});
