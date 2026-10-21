import { expect, test } from "./fixtures";
import { expectAccessible } from "./helpers";

/**
 * First production target, part 1 (§56): a restaurant owner registers,
 * creates a restaurant, adds a location and submits it for review.
 * Runs in Armenian (the default locale) on a phone viewport.
 */
test("owner registers, creates a restaurant and submits it for review", async ({ page }) => {
  const email = `owner-${Date.now()}@example.am`;

  // Register
  await page.goto("/register");
  await page.getByLabel("Անուն").fill("Անի");
  await page.getByLabel("Էլ. փոստ").fill(email);
  await page.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL("/home");

  // Empty dashboard → create
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Ստեղծել ռեստորան" }).click();
  await expect(page).toHaveURL("/dashboard/new");

  // Client-side validation
  await page.getByRole("button", { name: "Ստեղծել ռեստորան" }).click();
  await expect(page.getByText("Օգտագործեք առնվազն 2 նիշ։")).toBeVisible();

  await page.getByLabel("Ռեստորանի անվանումը").fill("Կասկադ Սրճարան");
  await page.getByRole("button", { name: "Ստեղծել ռեստորան" }).click();
  await expect(page).toHaveURL(/\/dashboard\/r\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Կասկադ Սրճարան" })).toBeVisible();
  await expect(page.getByText("Սևագիր")).toBeVisible();

  // Can't submit without a location
  const submit = page.getByRole("button", { name: "Ուղարկել ստուգման" });
  await expect(submit).toBeDisabled();

  await page.getByLabel("Մասնաճյուղի անվանումը").fill("Կասկադ");
  await page.getByLabel("Հասցե").fill("Թամանյան 10");
  await page.getByRole("button", { name: "Ավելացնել մասնաճյուղ" }).click();
  await expect(page.getByText("Թամանյան 10, Երևան")).toBeVisible();

  // Submit for review
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("Ստուգման մեջ")).toBeVisible();
  await expect(page.getByText("Ձեր ռեստորանը ստուգվում է")).toBeVisible();

  // Listed on the dashboard with its status
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Կասկադ Սրճարան/ })).toContainText("Ստուգման մեջ");
});

test("signed-out visitors are sent to login and come back after registering", async ({ page }) => {
  await page.goto("/dashboard/new");
  await expect(page).toHaveURL("/login?next=%2Fdashboard%2Fnew&for=restaurant");

  // The register link keeps ?next=, so the new user lands where they were going.
  await page.getByRole("link", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL("/register?next=%2Fdashboard%2Fnew&for=restaurant");
  await page.getByLabel("Անուն").fill("Բոբ");
  await page.getByLabel("Էլ. փոստ").fill(`bob-${Date.now()}@example.am`);
  await page.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL("/dashboard/new");
  await expect(page.getByRole("heading", { name: "Ստեղծեք ձեր ռեստորանը" })).toBeVisible();
});

test("a new owner comes from the home page and follows the setup guide", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("link", { name: "Ավելացրեք ձեր ռեստորանը՝ առաջին տարին անվճար" })
    .first()
    .click();
  await expect(page).toHaveURL("/register?for=restaurant");
  await expect(
    page.getByRole("heading", { level: 1, name: "Ստեղծեք ձեր ռեստորանի հաշիվը" }),
  ).toBeVisible();
  await expect(page.getByText("Ռեստորանների համար").first()).toBeVisible();
  await expectAccessible(page, "restaurant sign-up");

  // Guests can switch to the guest version, and back.
  await page.getByRole("link", { name: "Շարունակել որպես հյուր" }).click();
  await expect(page).toHaveURL("/register");
  await expect(page.getByRole("heading", { level: 1, name: "Ստեղծել հաշիվ" })).toBeVisible();
  await page.getByRole("link", { name: "Շարունակել որպես ռեստորան" }).click();
  await expect(page).toHaveURL("/register?for=restaurant");

  // Registering leads straight to creating the restaurant, with the guide.
  await page.getByLabel("Անուն").fill("Արամ");
  await page.getByLabel("Էլ. փոստ").fill(`guide-${Date.now()}@example.am`);
  await page.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL("/dashboard/new");
  const guide = page.getByRole("region", { name: "Սկսենք" });
  await expect(guide).toContainText("1-ը 6-ից արված է");
  await expect(guide.locator('[aria-current="step"]')).toContainText("Ռեստորանի տվյալներ");

  await page.getByLabel("Ռեստորանի անվանումը").fill("Ուղեցույց Սրճարան");
  await page.getByRole("button", { name: "Ստեղծել ռեստորան" }).click();
  await expect(page).toHaveURL(/\/dashboard\/r\/[0-9a-f-]{36}$/);
  await expect(guide).toContainText("2-ը 6-ից արված է");
  await expect(guide.locator('[aria-current="step"]')).toContainText("Ավելացրեք հասցեն");
  await expectAccessible(page, "setup guide");

  await page.getByLabel("Մասնաճյուղի անվանումը").fill("Կենտրոն");
  await page.getByLabel("Հասցե").fill("Աբովյան 5");
  await page.getByRole("button", { name: "Ավելացնել մասնաճյուղ" }).click();
  await expect(guide).toContainText("3-ը 6-ից արված է");

  // The next step links to the dishes.
  await guide.getByRole("link", { name: /Ավելացրեք ուտեստներ/ }).click();
  await expect(page).toHaveURL(/\/menu$/);
});
