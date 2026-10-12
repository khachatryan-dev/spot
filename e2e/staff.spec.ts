import { expect, test } from "./fixtures";

import { registerAndCreateRestaurant } from "./helpers";

async function register(page: import("@playwright/test").Page, name: string, email: string) {
  await page.getByLabel("Անուն").fill(name);
  await page.getByLabel("Էլ. փոստ").fill(email);
  await page.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
}

test("owner invites a waiter by link, changes the role and removes them", async ({
  page,
  browser,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const id = await registerAndCreateRestaurant(page, "Թիմ Ռեստորան");
  const waiterEmail = `waiter-${Date.now()}@example.am`;

  // Owner creates an invite link
  await page.getByRole("link", { name: "Թիմ", exact: true }).click();
  await expect(page).toHaveURL(`/dashboard/r/${id}/staff`);
  await page.getByLabel("Էլ. փոստ").fill(waiterEmail);
  await page.getByLabel("Դեր", { exact: true }).selectOption("waiter");
  await page.getByRole("button", { name: "Ստեղծել հրավերի հղում" }).click();
  const linkInput = page.getByRole("textbox", { name: "Հրավերի հղում" });
  await expect(linkInput).toHaveValue(/\/invite\/[A-Za-z0-9_-]{43}$/);
  const link = await linkInput.inputValue();
  await expect(page.getByText(waiterEmail)).toBeVisible(); // pending list

  // A stranger with the link can't use it
  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await stranger.goto("/register");
  await register(stranger, "Օտար", `stranger-${Date.now()}@example.am`);
  await expect(stranger).toHaveURL("/");
  await stranger.goto(link);
  await expect(stranger.getByText(/Դուք մուտք եք գործել որպես/)).toBeVisible();
  await expect(stranger.getByRole("button", { name: "Ընդունել հրավերը" })).toHaveCount(0);
  await strangerContext.close();

  // The invitee registers through the link and joins
  const waiterContext = await browser.newContext();
  const waiter = await waiterContext.newPage();
  await waiter.goto(link);
  await expect(waiter.getByText("Դուք հրավիրված եք Թիմ Ռեստորան՝ որպես Մատուցող։")).toBeVisible();
  await waiter.getByRole("link", { name: "Ստեղծել հաշիվ" }).click();
  await register(waiter, "Մատուցող", waiterEmail);
  await expect(waiter).toHaveURL(new RegExp("/invite/"));
  await waiter.getByRole("button", { name: "Ընդունել հրավերը" }).click();
  await expect(waiter).toHaveURL(`/dashboard/r/${id}`);
  await expect(waiter.getByRole("heading", { name: "Թիմ Ռեստորան" })).toBeVisible();

  // Link is single-use
  await waiter.goto(link);
  await expect(waiter.getByRole("heading", { name: "Հրավերն անվավեր է" })).toBeVisible();

  // Owner sees the new member, changes the role, then removes them
  await page.reload();
  const roleSelect = page.getByLabel("Մատուցող-ի դերը");
  await expect(roleSelect).toHaveValue("waiter");
  await roleSelect.selectOption("kitchen");
  await expect(page.getByText("Դերը թարմացված է։")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Հեռացնել Մատուցող-ին" }).click();
  await expect(page.getByText("Հեռացված է թիմից։")).toBeVisible();

  // The removed member loses access immediately
  await waiter.goto(`/dashboard/r/${id}`);
  await expect(waiter.getByRole("heading", { name: "Թիմ Ռեստորան" })).toHaveCount(0);
  await waiterContext.close();
});
