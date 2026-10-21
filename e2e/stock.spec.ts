import { expect, sql, test } from "./fixtures";
import { registerAndCreateRestaurant } from "./helpers";

test("owner limits menu hours; kitchen marks items out of stock", async ({ page, browser }) => {
  const restaurantId = await registerAndCreateRestaurant(page, "Խոհանոց Ռեստորան");

  // Owner: menu with an item that has a required size
  await page.getByRole("link", { name: "Մենյու", exact: true }).click();
  await page.getByRole("button", { name: "Ստեղծել մենյու" }).click();
  await expect(page).toHaveURL(/\/menu\/[0-9a-f-]{36}$/);
  const menuUrl = page.url();
  await page.getByLabel("Նոր բաժնի անվանումը").fill("Ապուրներ");
  await page.getByRole("button", { name: "Ավելացնել բաժին" }).click();
  await page.getByRole("link", { name: "Ավելացնել ուտեստ՝ Ապուրներ" }).click();
  await page.getByLabel("Անվանում", { exact: true }).fill("Խաշ");
  await page.getByLabel("Գին (AMD)").fill("4000");
  await page.getByRole("button", { name: "Ստեղծել ուտեստ" }).click();
  await page.getByLabel("Ընտրանքների խումբ").fill("Չափաբաժին");
  await page.getByRole("button", { name: "Ավելացնել խումբ" }).click();
  await page.getByLabel("Նոր ընտրանք՝ Չափաբաժին").fill("Կրկնակի");
  await page.getByRole("button", { name: "Ավելացնել ընտրանք" }).click();
  await expect(page.getByText("Անվճար")).toBeVisible();

  // Owner: serve this menu only Monday mornings
  await page.goto(menuUrl);
  await page.getByRole("radio", { name: "Միայն որոշակի ժամերին (օր.՝ նախաճաշ)" }).check();
  await page.getByRole("checkbox", { name: "Երկուշաբթի" }).check();
  await page.getByLabel("Երկուշաբթի՝ բացվում է").fill("08:00");
  await page.getByLabel("Երկուշաբթի՝ փակվում է").fill("12:00");
  await page.getByRole("button", { name: "Պահպանել կարգավորումները" }).click();
  await expect(page.getByText("Մենյուն պահպանված է։")).toBeVisible();
  const [menu] = await sql`SELECT available_hours FROM menus WHERE restaurant_id = ${restaurantId}`;
  expect(menu?.available_hours.mon).toEqual([{ open: "08:00", close: "12:00" }]);

  // Kitchen staff member
  const cookEmail = `cook-${Date.now()}@example.am`;
  const cookContext = await browser.newContext();
  const cook = await cookContext.newPage();
  await cook.goto("/register");
  await cook.getByLabel("Անուն").fill("Խոհարար");
  await cook.getByLabel("Էլ. փոստ").fill(cookEmail);
  await cook.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await cook.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(cook).toHaveURL("/home");
  await sql`
    INSERT INTO restaurant_staff (restaurant_id, user_id, role)
    SELECT ${restaurantId}, id, 'kitchen' FROM users WHERE email = ${cookEmail}`;

  // Kitchen sees the dashboard, the Stock tab, and no Staff tab
  await cook.goto(`/dashboard/r/${restaurantId}`);
  await expect(cook.getByRole("heading", { name: "Խոհանոց Ռեստորան" })).toBeVisible();
  const tabs = cook.getByRole("navigation", { name: "Ռեստորանի բաժիններ" });
  await expect(tabs.getByRole("link", { name: "Պաշար" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Թիմ" })).toHaveCount(0);

  // Mark the item and its option out of stock
  await tabs.getByRole("link", { name: "Պաշար" }).click();
  const soup = cook.getByRole("switch", { name: "Խաշ՝ առկա է", exact: true });
  await expect(soup).toHaveAttribute("aria-checked", "true");
  await soup.click();
  await expect(soup).toHaveAttribute("aria-checked", "false");
  await expect(soup).toContainText("Առկա չէ");
  await cook.getByRole("switch", { name: "Կրկնակի — Խաշ՝ առկա է" }).click();
  await expect(cook.getByRole("switch", { name: "Կրկնակի — Խաշ՝ առկա է" })).toHaveAttribute(
    "aria-checked",
    "false",
  );

  // Search filters the list
  await cook.getByRole("searchbox", { name: "Գտնել ուտեստ" }).fill("պիցցա");
  await expect(cook.getByText("Ցուցադրելու ուտեստ չկա։")).toBeVisible();

  // Persisted
  await expect
    .poll(
      async () =>
        (
          await sql`SELECT is_available FROM menu_items WHERE restaurant_id = ${restaurantId} AND name = 'Խաշ'`
        )[0]?.is_available,
    )
    .toBe(false);
  // The switch flips before the save finishes: wait for it.
  await expect
    .poll(
      async () =>
        (
          await sql`SELECT is_available FROM modifiers WHERE restaurant_id = ${restaurantId} AND name = 'Կրկնակի'`
        )[0]?.is_available,
    )
    .toBe(false);

  // Kitchen can't open the staff page directly either
  const response = await cook.goto(`/dashboard/r/${restaurantId}/staff`);
  expect(response?.status()).toBe(404);
  await cookContext.close();
});
