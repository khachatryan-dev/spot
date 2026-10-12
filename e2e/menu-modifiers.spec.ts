import { expect, sql, test } from "./fixtures";
import { registerAndCreateRestaurant } from "./helpers";

test("owner configures item options (size, extras)", async ({ page }) => {
  const restaurantId = await registerAndCreateRestaurant(page, "Պիցցա Ռեստորան");
  await page.getByRole("link", { name: "Մենյու", exact: true }).click();
  await page.getByRole("button", { name: "Ստեղծել մենյու" }).click();
  await page.getByLabel("Նոր բաժնի անվանումը").fill("Պիցցա");
  await page.getByRole("button", { name: "Ավելացնել բաժին" }).click();
  await page.getByRole("link", { name: "Ավելացնել ուտեստ՝ Պիցցա" }).click();
  await page.getByLabel("Անվանում", { exact: true }).fill("Մարգարիտա");
  await page.getByLabel("Գին (AMD)").fill("3500");
  await page.getByRole("button", { name: "Ստեղծել ուտեստ" }).click();
  await expect(page.getByRole("heading", { name: "Մարգարիտա" })).toBeVisible();

  // Required "Size": pick 1
  await page.getByLabel("Ընտրանքների խումբ").fill("Չափս");
  await page.getByRole("button", { name: "Ավելացնել խումբ" }).click();
  const size = page.getByRole("group", { name: "Չափս" });
  await expect(size).toContainText("Ընտրել 1");
  // Required with no options yet → warning
  await expect(size.getByRole("alert")).toBeVisible();

  await size.getByLabel("Նոր ընտրանք՝ Չափս").fill("Փոքր");
  await size.getByRole("button", { name: "Ավելացնել ընտրանք" }).click();
  await expect(size.getByText("Անվճար")).toBeVisible();
  await size.getByLabel("Նոր ընտրանք՝ Չափս").fill("Մեծ");
  await size.getByLabel("Հավելյալ գին՝ Չափս (AMD)").fill("500");
  await size.getByRole("button", { name: "Ավելացնել ընտրանք" }).click();
  await expect(size.getByText("+500 ֏")).toBeVisible();
  await expect(size.getByRole("alert")).toHaveCount(0);

  await size.getByRole("button", { name: "Դարձնել Փոքր-ը լռելյայն" }).click();
  await expect(size.getByText("Լռելյայն")).toBeVisible();

  // Optional "Extras": up to 3
  await page.getByLabel("Ընտրանքների խումբ").fill("Հավելումներ");
  await page.getByRole("checkbox", { name: "Պարտադիր" }).last().uncheck();
  await page.getByLabel("Մինչև").last().fill("3");
  await page.getByRole("button", { name: "Ավելացնել խումբ" }).click();
  const extras = page.getByRole("group", { name: "Հավելումներ" });
  await expect(extras).toContainText("Ըստ ցանկության, մինչև 3");
  await extras.getByLabel("Նոր ընտրանք՝ Հավելումներ").fill("Պանիր");
  await extras.getByLabel("Հավելյալ գին՝ Հավելումներ (AMD)").fill("300");
  await extras.getByRole("button", { name: "Ավելացնել ընտրանք" }).click();
  await expect(extras.getByText("+300 ֏")).toBeVisible();

  // Move Extras above Size
  await page.getByRole("button", { name: "Տեղափոխել Հավելումներ-ը վերև" }).click();
  await expect(
    page.getByRole("region", { name: "Ընտրանքներ" }).getByRole("group").first(),
  ).toHaveAccessibleName("Հավելումներ");

  // All sizes out of stock → required group can't be satisfied → warning
  await size.getByRole("checkbox", { name: "Փոքր՝ առկա է" }).uncheck();
  await expect(size.getByRole("checkbox", { name: "Փոքր՝ առկա է" })).not.toBeChecked();
  await size.getByRole("checkbox", { name: "Մեծ՝ առկա է" }).uncheck();
  await expect(size.getByRole("alert")).toBeVisible();

  // Stored correctly
  const rows = await sql`
    SELECT g.name AS group, g.min_select, g.max_select, m.name, m.price_delta_minor, m.is_default
    FROM modifiers m JOIN modifier_groups g ON g.id = m.group_id
    JOIN menu_items i ON i.id = g.item_id
    WHERE i.restaurant_id = ${restaurantId} AND i.name = 'Մարգարիտա'
    ORDER BY g.sort_order, m.sort_order`;
  expect(
    rows.map((r) => [
      r.group,
      r.min_select,
      r.max_select,
      r.name,
      r.price_delta_minor,
      r.is_default,
    ]),
  ).toEqual([
    ["Հավելումներ", 0, 3, "Պանիր", 30000, false],
    ["Չափս", 1, 1, "Փոքր", 0, true],
    ["Չափս", 1, 1, "Մեծ", 50000, false],
  ]);

  // Delete the extras group
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Ջնջել Հավելումներ խումբը" }).click();
  await expect(page.getByRole("group", { name: "Հավելումներ" })).toHaveCount(0);
});
