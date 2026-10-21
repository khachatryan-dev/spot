import { expect, test } from "./fixtures";
import { expectAccessible, setupActiveTable } from "./helpers";

test("guests move around the customer app with the bottom bar", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Signed out: the home invites to sign in.
  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1, name: "Բարի գալուստ Spot։" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Մուտք", exact: true })).toBeVisible();

  await page.goto("/register");
  await page.getByLabel("Անուն").fill("Մարիամ Սարգսյան");
  await page.getByLabel("Էլ. փոստ").fill(`app-${Date.now()}@example.am`);
  await page.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  // Signing up lands on the app's home.
  await expect(page).toHaveURL("/home");
  await expect(page.getByRole("heading", { level: 1, name: "Բարև, Մարիամ։" })).toBeVisible();
  await expect(page.getByText("Այցեր")).toBeVisible();
  await expect(page.getByRole("link", { name: /Գտեք ձեր առաջին վայրը/ })).toBeVisible();
  await expectAccessible(page, "customer home");
  const bar = page.getByRole("navigation", { name: "Հավելված" });
  await expect(bar.getByRole("link", { name: "Գլխավոր" })).toHaveAttribute("aria-current", "page");

  // Scan, the big middle button.
  await bar.getByRole("link", { name: "Սկանավորել" }).click();
  await expect(page).toHaveURL("/scan");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Սկանավորեք սեղանի QR կոդը");
  await expectAccessible(page, "scan");

  // Explore keeps the bar on the public restaurant list.
  await bar.getByRole("link", { name: "Որոնում" }).click();
  await expect(page).toHaveURL("/restaurants");
  await expect(bar.getByRole("link", { name: "Որոնում" })).toHaveAttribute("aria-current", "page");

  await bar.getByRole("link", { name: "Ամրագրումներ" }).click();
  await expect(page).toHaveURL("/reservations");
  await expect(page.getByText("Դուք դեռ ամրագրումներ չունեք։")).toBeVisible();
  await expectAccessible(page, "bookings");
  await bar.getByRole("link", { name: "Պրոֆիլ" }).click();
  await expect(page).toHaveURL("/account");
  await expect(bar.getByRole("link", { name: "Պրոֆիլ" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Պրոֆիլ" })).toContainText("Մարիամ Սարգսյան");
  await expectAccessible(page, "profile");
  await page
    .getByRole("navigation", { name: "Արագ հղումներ" })
    .getByRole("link", { name: "Ծանուցումներ" })
    .click();
  await expect(page).toHaveURL("/notifications");
  await page.goBack();

  // Nothing wider than the phone.
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBe(page.viewportSize()!.width);

  await page.getByRole("button", { name: "Ելք" }).click();
  await expect(page).toHaveURL("/");
});

test("at a table, home shows the table with quick links", async ({ page, browser }) => {
  const { token } = await setupActiveTable(page, "Տնային Սրճարան");

  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.emulateMedia({ reducedMotion: "reduce" });
  await guest.goto(`/t/${token}`);
  await expect(guest).toHaveURL("/table");
  // The table page keeps its own header and cart bar: no app bars there.
  await expect(guest.getByRole("navigation", { name: "Հավելված" })).toHaveCount(0);

  await guest.goto("/home");
  const table = guest.getByRole("region", { name: "Դուք 1 սեղանի մոտ եք" });
  await expect(table).toContainText("Տնային Սրճարան");
  await expectAccessible(guest, "home at a table");
  await table.getByRole("link", { name: "Մենյու" }).click();
  await expect(guest).toHaveURL("/table");
  await context.close();
});

test("the scanner opens a table from a photo, and refuses other codes", async ({
  page,
  browser,
  baseURL,
}) => {
  const { token } = await setupActiveTable(page, "Սկաների Սրճարան");
  const QRCode = await import("qrcode");

  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.emulateMedia({ reducedMotion: "reduce" });
  await guest.goto("/scan");
  // The test browser has no camera: the page says so and offers a photo instead.
  await expect(guest.getByText(/Տեսախցիկը հասանելի չէ/)).toBeVisible();
  await expectAccessible(guest, "scanner without a camera");

  const photo = guest.locator('input[type="file"]');
  await photo.setInputFiles({
    name: "other.png",
    mimeType: "image/png",
    buffer: await QRCode.toBuffer("https://example.com/t/AbCdEfGhIjKlMnOpQrStUv", { width: 400 }),
  });
  await expect(guest.getByRole("status")).toHaveText(
    "Սա Spot-ի սեղանի կոդ չէ։ Փորձեք ձեր սեղանի կոդը։",
  );

  await photo.setInputFiles({
    name: "table.png",
    mimeType: "image/png",
    buffer: await QRCode.toBuffer(`${baseURL}/t/${token}`, { width: 400 }),
  });
  await expect(guest).toHaveURL("/table");
  await expect(guest.getByRole("heading", { level: 1, name: "Սեղան 1" })).toBeVisible();
  await context.close();
});
