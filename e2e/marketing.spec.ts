import { expect, type Page, sql, test } from "./fixtures";
import { expectAccessible } from "./helpers";

/** Decorative motion is off under "reduce motion"; measure the settled page. */
async function calm(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
}

/** Nothing wider than the phone: otherwise the browser zooms out and taps miss. */
async function expectNoSideScroll(page: Page) {
  const width = await page.evaluate(() => [
    window.innerWidth,
    document.documentElement.scrollWidth,
  ]);
  expect(width).toEqual([page.viewportSize()!.width, page.viewportSize()!.width]);
}

test("the home page shows guests and restaurants where to go", async ({ page }) => {
  await calm(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2, name: "Ո՞վ եք դուք" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ուզում եմ դրսում ճաշել" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ես ռեստորան ունեմ" })).toBeVisible();
  await expect(page.getByRole("button", { name: "EN" })).toBeInViewport({ ratio: 1 });
  await expectNoSideScroll(page);
  await expectAccessible(page, "home");

  // Restaurant door: the restaurant sign-up.
  await page
    .getByRole("link", { name: "Ավելացրեք ձեր ռեստորանը՝ առաջին տարին անվճար" })
    .first()
    .click();
  await expect(page).toHaveURL("/register?for=restaurant");

  // Guest door: the restaurant list.
  await page.goto("/");
  await page.getByRole("link", { name: "Գտնել ռեստորան" }).first().click();
  await expect(page).toHaveURL("/restaurants");

  await page.goto("/en");
  await expect(page.getByRole("heading", { name: "I run a restaurant" })).toBeVisible();
});

test("about, FAQ and legal pages are linked from the footer in both languages", async ({
  page,
}) => {
  await calm(page);
  const footer = () => page.getByRole("contentinfo");
  const pages = [
    ["Մեր մասին", "/about", "Համեղ ուտելիք, քիչ սպասում"],
    ["Հարցեր և պատասխաններ", "/faq", "Հարցեր և պատասխաններ"],
    ["Գաղտնիության քաղաքականություն", "/privacy", "Գաղտնիության քաղաքականություն"],
    ["Օգտագործման պայմաններ", "/terms", "Օգտագործման պայմաններ"],
  ] as const;
  for (const [link, path, heading] of pages) {
    await page.goto("/");
    await footer().getByRole("link", { name: link }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expectNoSideScroll(page);
    await expectAccessible(page, path);
  }

  // FAQ answers open on tap.
  await page.goto("/faq");
  await page.getByText("Որքա՞ն արժե Spot-ը").click();
  await expect(page.getByText(/անվճար է առաջին տարում/)).toBeVisible();

  // Legal pages: contents jump to a section.
  await page.goto("/en/privacy");
  await page
    .getByRole("navigation", { name: "Contents" })
    .getByRole("link", { name: /Cookies/ })
    .click();
  await expect(page).toHaveURL(/#cookies$/);
  await expect(page.getByRole("heading", { level: 2, name: "6. Cookies" })).toBeInViewport();

  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  for (const path of ["/about", "/contact", "/faq", "/privacy", "/terms"]) {
    expect(sitemap).toContain(path);
  }
});

test("a visitor writes through the contact form and an admin handles it", async ({
  page,
  browser,
}) => {
  await calm(page);
  await page.goto("/contact?topic=restaurant");
  await expect(page.getByRole("heading", { level: 1, name: "Կապ մեզ հետ" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Ռեստորան" })).toBeChecked();
  await expectNoSideScroll(page);
  await expectAccessible(page, "contact");

  // Too short is refused before sending.
  const name = `Անի ${Date.now()}`;
  await page.getByLabel("Ձեր անունը").fill(name);
  await page.getByLabel("Էլ. փոստ").fill("ani@example.am");
  await page.getByLabel("Հաղորդագրություն").fill("Բարև");
  await page.getByRole("button", { name: "Ուղարկել" }).click();
  await expect(page.getByText("Գրեք առնվազն 10 նիշ։")).toBeVisible();

  await page.getByLabel("Հաղորդագրություն").fill("Ուզում ենք միացնել մեր սրճարանը Spot-ին։");
  await page.getByRole("button", { name: "Ուղարկել" }).click();
  await expect(page.getByRole("status")).toContainText("Շնորհակալություն");

  // A platform admin sees it under Messages and closes it.
  const adminEmail = `admin-msg-${Date.now()}@example.am`;
  const context = await browser.newContext();
  const admin = await context.newPage();
  await admin.goto("/register");
  await admin.getByLabel("Անուն").fill("Ադմին");
  await admin.getByLabel("Էլ. փոստ").fill(adminEmail);
  await admin.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await admin.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(admin).toHaveURL("/home");
  await sql`UPDATE users SET platform_role = 'platform_admin' WHERE email = ${adminEmail}`;

  await admin.goto("/admin");
  await admin.getByRole("link", { name: /Հաղորդագրություններ/ }).click();
  await expect(admin).toHaveURL("/admin/messages");
  const item = admin.getByRole("listitem").filter({ hasText: name });
  await expect(item).toContainText("Ուզում ենք միացնել մեր սրճարանը");
  await expect(item).toContainText("Ռեստորան");
  await expectAccessible(admin, "admin messages");
  await item.getByRole("button", { name: `Նշել ${name}-ի հաղորդագրությունը մշակված` }).click();
  await expect(admin.getByText(name)).toHaveCount(0);

  await admin.getByRole("link", { name: "Մշակված" }).click();
  await expect(admin.getByRole("listitem").filter({ hasText: name })).toBeVisible();
  await context.close();
});
