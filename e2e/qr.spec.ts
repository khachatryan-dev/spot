import { expect, sql, test } from "./fixtures";
import { registerAndCreateRestaurant } from "./helpers";

test("owner creates, replaces and prints table QR codes", async ({ page }) => {
  const id = await registerAndCreateRestaurant(page, "QR Սրճարան");
  await page.getByLabel("Մասնաճյուղի անվանումը").fill("Կենտրոն");
  await page.getByLabel("Հասցե").fill("Աբովյան 1");
  await page.getByRole("button", { name: "Ավելացնել մասնաճյուղ" }).click();
  await expect(page.getByText("Աբովյան 1, Երևան")).toBeVisible();

  await page.getByRole("link", { name: "Սեղաններ", exact: true }).click();
  await page.getByLabel("Մինչև").fill("3");
  await page.getByRole("button", { name: "Ավելացնել 1–3 սեղանները" }).click();
  await expect(page.getByText("3 սեղան դեռ QR կոդ չունի։")).toBeVisible();

  // One click: codes for every table
  await page.getByRole("button", { name: "Ստեղծել QR կոդեր" }).click();
  await expect(page.getByText("Բոլոր սեղաններն ունեն QR կոդ։")).toBeVisible();

  // Show table 1's code
  await page.getByRole("button", { name: "1 սեղանի QR կոդը" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: "1 սեղանի QR կոդը" })).toBeVisible();
  const url = dialog.getByTestId("qr-url");
  await expect(url).toHaveText(/\/t\/[A-Za-z0-9_-]{22}$/);
  const firstUrl = (await url.textContent())!;
  const firstToken = firstUrl.split("/t/")[1]!;

  // Replace it: new link, old token revoked
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "Փոխարինել կոդը" }).click();
  await expect(page.getByText("Նոր QR կոդը ստեղծված է։ Տպեք այն սեղանի համար։")).toBeVisible();
  await expect(url).not.toHaveText(firstUrl);
  const [old] = await sql`SELECT revoked_at FROM qr_tokens WHERE token = ${firstToken}`;
  expect(old?.revoked_at).not.toBeNull();
  await page.keyboard.press("Escape");

  // Print sheet: one card per table, bilingual
  await page.getByRole("link", { name: "Տպել QR քարտերը" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/r/${id}/tables/print\\?location=`));
  const cards = page.getByRole("list", { name: "QR քարտեր" }).getByRole("listitem");
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText("QR Սրճարան");
  await expect(cards.first()).toContainText("Սկանավորեք՝ մենյուն տեսնելու և պատվիրելու համար");
  await expect(cards.first()).toContainText("Scan to see the menu and order");
  await expect(cards.first().getByRole("img")).toBeVisible();
  await expect(page.getByRole("button", { name: "Տպել" })).toBeVisible();

  // Dashboard chrome is hidden when printing
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation", { name: "Ռեստորանի բաժիններ" })).toBeHidden();
  await expect(cards).toHaveCount(3);
});
