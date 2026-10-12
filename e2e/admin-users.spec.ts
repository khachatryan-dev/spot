import { type Browser, expect, sql, test } from "./fixtures";
import { expectAccessible } from "./helpers";

const PASSWORD = "correct horse battery";

async function signUp(browser: Browser, name: string, email: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/register");
  await page.getByLabel("Անուն").fill(name);
  await page.getByLabel("Էլ. փոստ").fill(email);
  await page.getByLabel("Գաղտնաբառ").fill(PASSWORD);
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL("/");
  return page;
}

/** Platform admins suspend and restore accounts; suspension signs the person out at once. */
test("an admin suspends and restores an account", async ({ browser }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const adminEmail = `admin-${stamp}@example.am`;
  const guestEmail = `tigran-${stamp}@example.am`;
  const admin = await signUp(browser, "Ադմին", adminEmail);
  await sql`UPDATE users SET platform_role = 'platform_admin' WHERE email = ${adminEmail}`;
  const guest = await signUp(browser, "Տիգրան", guestEmail);
  await guest.goto("/account");
  await expect(guest.getByRole("heading", { name: "Իմ հաշիվը" })).toBeVisible();

  await admin.goto(`/admin/users?q=${encodeURIComponent(guestEmail)}`);
  const row = admin.getByRole("list", { name: "Օգտատերեր" }).getByRole("listitem");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Տիգրան");
  await expectAccessible(admin, "admin users");
  await row.getByRole("button", { name: "Կասեցնել Տիգրան-ին" }).click();
  const dialog = admin.getByRole("dialog", { name: "Կասեցնել Տիգրան-ին" });
  await dialog.getByLabel("Պատճառ").fill("Կեղծ կարծիքներ");
  await dialog.getByRole("button", { name: "Կասեցնել" }).click();
  await expect(admin.getByText("Հաշիվը կասեցված է։")).toBeVisible();
  await expect(row).toContainText("Կասեցված է՝ Կեղծ կարծիքներ");

  // Signed out at once; signing in again is refused with a clear message.
  await guest.goto("/account");
  await expect(guest).toHaveURL(/\/login/);
  await guest.getByLabel("Էլ. փոստ").fill(guestEmail);
  await guest.getByLabel("Գաղտնաբառ").fill(PASSWORD);
  await guest.getByRole("button", { name: "Մուտք գործել" }).click();
  await expect(guest.getByText(/^Այս հաշիվը կասեցված է։/)).toBeVisible();

  // Restored: they can sign in again.
  await row.getByRole("button", { name: "Վերականգնել Տիգրան-ին" }).click();
  await expect(admin.getByText("Հաշիվը վերականգնված է։")).toBeVisible();
  await guest.getByRole("button", { name: "Մուտք գործել" }).click();
  await expect(guest).not.toHaveURL(/\/login/);
  const [audit] = await sql`
    SELECT count(*)::int AS n FROM audit_logs
    WHERE action IN ('user.suspended', 'user.restored') AND metadata->>'email' = ${guestEmail}`;
  expect(audit!.n).toBe(2);
});
