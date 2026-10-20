import { expect, type Page, test } from "./fixtures";
import { expectAccessible, registerAndCreateRestaurant } from "./helpers";

const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));

/** Watch for the CSP blocking the theme script (it needs the page's nonce). */
function cspErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test("pages follow the device's dark mode and the switch remembers a choice", async ({ page }) => {
  const errors = cspErrors(page);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });

  for (const path of ["/", "/contact", "/register?for=restaurant", "/faq"]) {
    await page.goto(path);
    expect(await isDark(page)).toBe(true);
    await expectAccessible(page, `${path} (dark)`);
  }

  // Footer switch → light, kept after a reload.
  await page.goto("/");
  await page.getByRole("button", { name: "Միացնել լուսավոր ռեժիմը" }).click();
  expect(await isDark(page)).toBe(false);
  await page.reload();
  expect(await isDark(page)).toBe(false);
  await expect(page.getByRole("button", { name: "Միացնել մութ ռեժիմը" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the dashboard works in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await registerAndCreateRestaurant(page, "Մութ Սրճարան");
  expect(await isDark(page)).toBe(true);
  await expect(page.getByRole("region", { name: "Սկսենք" })).toBeVisible();
  await expectAccessible(page, "restaurant overview (dark)");
});
