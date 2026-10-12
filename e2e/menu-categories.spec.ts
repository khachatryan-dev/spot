import { expect, test } from "./fixtures";
import { registerAndCreateRestaurant } from "./helpers";

test("owner creates a menu and manages its categories", async ({ page }) => {
  const id = await registerAndCreateRestaurant(page, "Մենյու Ռեստորան");
  await page.getByLabel("Մասնաճյուղի անվանումը").fill("Կենտրոն");
  await page.getByLabel("Հասցե").fill("Աբովյան 1");
  await page.getByRole("button", { name: "Ավելացնել մասնաճյուղ" }).click();
  await expect(page.getByText("Աբովյան 1, Երևան")).toBeVisible();

  // Create the first menu (served at the location by default)
  await page.getByRole("link", { name: "Մենյու", exact: true }).click();
  await expect(page.getByLabel("Մենյուի անվանումը")).toHaveValue("Հիմնական մենյու");
  await page.getByRole("button", { name: "Ստեղծել մենյու" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/r/${id}/menu/[0-9a-f-]{36}$`));
  await expect(page.getByRole("checkbox", { name: "Կենտրոն" })).toBeChecked();

  // Add three categories
  for (const name of ["Աղցաններ", "Ապուրներ", "Ըմպելիքներ"]) {
    await page.getByLabel("Նոր բաժնի անվանումը").fill(name);
    await page.getByRole("button", { name: "Ավելացնել բաժին" }).click();
    await expect(page.getByLabel("Նոր բաժնի անվանումը")).toHaveValue("");
  }
  const rows = page.getByRole("listitem").filter({ hasText: "ուտեստ չկա" });
  await expect(rows).toHaveText([/Աղցաններ/, /Ապուրներ/, /Ըմպելիքներ/]);

  // Reorder: move Drinks up twice
  await page.getByRole("button", { name: "Տեղափոխել Ըմպելիքներ-ը վերև" }).click();
  await expect(rows).toHaveText([/Աղցաններ/, /Ըմպելիքներ/, /Ապուրներ/]);
  await page.getByRole("button", { name: "Տեղափոխել Ըմպելիքներ-ը վերև" }).click();
  await expect(rows).toHaveText([/Ըմպելիքներ/, /Աղցաններ/, /Ապուրներ/]);

  // Rename
  await page.getByRole("button", { name: "Վերանվանել Ապուրներ-ը" }).click();
  await page.getByRole("textbox", { name: "Վերանվանել Ապուրներ-ը" }).fill("Տաք ապուրներ");
  await page.getByRole("button", { name: "Պահպանել անվանումը" }).click();
  await expect(rows.nth(2)).toContainText("Տաք ապուրներ");

  // Hide from guests
  await page.getByRole("button", { name: "Թաքցնել Աղցաններ-ը հյուրերից" }).click();
  await expect(rows.nth(1)).toContainText("Թաքցված");

  // Delete an (empty) category
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Ջնջել Տաք ապուրներ-ը" }).click();
  await expect(rows).toHaveCount(2);

  // Order survives a reload; rename the menu
  await page.reload();
  await expect(rows).toHaveText([/Ըմպելիքներ/, /Աղցաններ/]);
  await page.getByLabel("Մենյուի անվանումը").fill("Ամառային մենյու");
  await page.getByRole("button", { name: "Պահպանել կարգավորումները" }).click();
  await expect(page.getByText("Մենյուն պահպանված է։")).toBeVisible();
  await page.getByRole("link", { name: "Բոլոր մենյուները" }).click();
  await expect(page.getByRole("link", { name: /Ամառային մենյու/ })).toContainText("1 մասնաճյուղ");
});
