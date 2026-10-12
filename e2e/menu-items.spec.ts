import sharp from "sharp";

import { expect, sql, test } from "./fixtures";
import { registerAndCreateRestaurant } from "./helpers";

test("owner adds, edits and removes a menu item", async ({ page }) => {
  const id = await registerAndCreateRestaurant(page, "Ուտեստ Ռեստորան");
  await page.getByRole("link", { name: "Մենյու", exact: true }).click();
  await page.getByRole("button", { name: "Ստեղծել մենյու" }).click();
  await page.getByLabel("Նոր բաժնի անվանումը").fill("Աղցաններ");
  await page.getByRole("button", { name: "Ավելացնել բաժին" }).click();

  // New item
  await page.getByRole("link", { name: "Ավելացնել ուտեստ՝ Աղցաններ" }).click();
  await page.getByLabel("Անվանում", { exact: true }).fill("Կեսար");
  await page.getByLabel("Գին (AMD)").fill("abc");
  await page.getByRole("button", { name: "Ստեղծել ուտեստ" }).click();
  await expect(page.getByText("Մուտքագրեք վավեր գին, օր.՝ 3500։")).toBeVisible();

  await page.getByLabel("Գին (AMD)").fill("3 500");
  await page.getByLabel("Բաղադրություն").fill("Հավ, մարուլ, պարմեզան");
  await page.getByRole("button", { name: "Սնձան (գլյուտեն)", exact: true }).click();
  await page.getByRole("button", { name: "Կաթ", exact: true }).click();
  await page.getByRole("button", { name: "Ձու", exact: true }).click();
  await page.getByRole("button", { name: "Ստեղծել ուտեստ" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/r/${id}/menu/.+/items/[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { name: "Կեսար" })).toBeVisible();

  // Stored exactly as minor units (3 500 AMD = 350000), allergens kept
  // Scoped to this test's restaurant: other tests use the same item names.
  const [row] =
    await sql`SELECT price_minor, allergens FROM menu_items WHERE restaurant_id = ${id} AND name = 'Կեսար'`;
  expect(row).toEqual({ price_minor: 350000, allergens: ["gluten", "milk", "eggs"] });

  // Photo
  const photo = await sharp({
    create: { width: 800, height: 800, channels: 3, background: "#6a4" },
  })
    .jpeg()
    .toBuffer();
  await page
    .locator("#upload-item")
    .setInputFiles({ name: "salad.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByRole("img", { name: "Լուսանկար" })).toBeVisible();

  // Edit price and mark out of stock
  await page.getByLabel("Գին (AMD)").fill("3800");
  await page.getByRole("checkbox", { name: "Առկա է" }).uncheck();
  await page.getByRole("button", { name: "Պահպանել ուտեստը" }).click();
  await expect(page.getByText("Ուտեստը պահպանված է։")).toBeVisible();

  // The menu editor shows it with a formatted price and an out-of-stock badge
  await page.getByRole("link", { name: "Վերադառնալ մենյու" }).click();
  const row2 = page.getByRole("link", { name: /Կեսար/ });
  await expect(row2).toContainText(/3[\s  ,]?800/);
  await expect(row2).toContainText("Առկա չէ");
  await expect(row2.locator("img")).toBeVisible(); // decorative thumbnail (alt="")

  // Delete
  await row2.click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Ջնջել ուտեստը" }).click();
  await expect(page.getByText("Ուտեստներ դեռ չկան։")).toBeVisible();
});
