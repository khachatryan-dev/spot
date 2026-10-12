import { expect, sql, test } from "./fixtures";
import { registerAndCreateRestaurant } from "./helpers";

test("admin requests changes, owner resubmits, admin approves", async ({ page, browser }) => {
  // Owner submits a restaurant
  const id = await registerAndCreateRestaurant(page, "Ստուգման Ռեստորան");
  await page.getByLabel("Մասնաճյուղի անվանումը").fill("Կենտրոն");
  await page.getByLabel("Հասցե").fill("Աբովյան 1");
  await page.getByRole("button", { name: "Ավելացնել մասնաճյուղ" }).click();
  await page.getByRole("button", { name: "Ուղարկել ստուգման" }).click();
  await expect(page.getByText("Ստուգման մեջ").first()).toBeVisible();

  // A platform admin (registered normally, promoted in the DB)
  const adminEmail = `admin-${Date.now()}@example.am`;
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await admin.goto("/register");
  await admin.getByLabel("Անուն").fill("Ադմին");
  await admin.getByLabel("Էլ. փոստ").fill(adminEmail);
  await admin.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await admin.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(admin).toHaveURL("/");
  await sql`UPDATE users SET platform_role = 'platform_admin' WHERE email = ${adminEmail}`;

  await admin.goto("/admin");
  await admin.getByRole("link", { name: /Ստուգման Ռեստորան/ }).click();
  await expect(admin).toHaveURL(`/admin/restaurants/${id}`);
  await expect(admin.getByText("Աբովյան 1")).toBeVisible();

  // Request changes — a vague reason is refused
  await admin.getByRole("button", { name: "Պահանջել փոփոխություններ" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByLabel("Պատճառը (կտեսնի սեփականատերը)").fill("Ոչ");
  await dialog.getByRole("button", { name: "Պահանջել փոփոխություններ" }).click();
  await expect(dialog.getByText("Գրեք առնվազն 10 նիշ։")).toBeVisible();
  await dialog
    .getByLabel("Պատճառը (կտեսնի սեփականատերը)")
    .fill("Ավելացրեք ռեստորանի հեռախոսահամարը։");
  await dialog.getByRole("button", { name: "Պահանջել փոփոխություններ" }).click();
  await expect(admin.getByText("Վերադարձվել է սեփականատիրոջը՝ ձեր պատճառով։")).toBeVisible();

  // Owner sees the reason and resubmits
  await page.reload();
  await expect(page.getByText("Ավելացրեք ռեստորանի հեռախոսահամարը։")).toBeVisible();
  await page.getByRole("button", { name: "Ուղարկել ստուգման" }).click();
  await expect(page.getByText("Ստուգման մեջ").first()).toBeVisible();

  // Admin approves
  await admin.reload();
  await admin.getByRole("button", { name: "Հաստատել" }).click();
  await expect(admin.getByText("Ռեստորանը հաստատված է․ այժմ հասանելի է բոլորին։")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Ակտիվ")).toBeVisible();

  // Every decision is in the audit log, filtered to this restaurant
  await admin.goto(`/admin/audit?restaurant=${id}`);
  const log = admin.getByRole("table");
  await expect(log.getByText("restaurant.approved")).toBeVisible();
  await expect(log.getByText("restaurant.rejected")).toBeVisible();
  await expect(log.getByText(/Ավելացրեք ռեստորանի հեռախոսահամարը/)).toBeVisible();
  await expect(log.getByText(adminEmail).first()).toBeVisible();
  await adminContext.close();
});

test("non-admins get a 404 on the admin area", async ({ page }) => {
  await registerAndCreateRestaurant(page, "Ոչ Ադմին");
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
});
