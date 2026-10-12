import { expect, sql, test } from "./fixtures";
import { registerAndCreateRestaurant } from "./helpers";

test("guests scan a table QR code and share one table session", async ({ page, browser }) => {
  // Owner: active restaurant, table 1 with a QR code
  const restaurantId = await registerAndCreateRestaurant(page, "Սկան Ռեստորան");
  await page.getByLabel("Մասնաճյուղի անվանումը").fill("Կենտրոն");
  await page.getByLabel("Հասցե").fill("Աբովյան 1");
  await page.getByRole("button", { name: "Ավելացնել մասնաճյուղ" }).click();
  await expect(page.getByText("Աբովյան 1, Երևան")).toBeVisible();
  await page.getByRole("link", { name: "Սեղաններ", exact: true }).click();
  await page.getByLabel("Մինչև").fill("1");
  await page.getByRole("button", { name: "Ավելացնել 1–1 սեղանները" }).click();
  await page.getByRole("button", { name: "Ստեղծել QR կոդեր" }).click();
  await expect(page.getByText("Բոլոր սեղաններն ունեն QR կոդ։")).toBeVisible();
  await sql`UPDATE restaurants SET status = 'active' WHERE id = ${restaurantId}`;
  const [qrRow] =
    await sql`SELECT token FROM qr_tokens WHERE restaurant_id = ${restaurantId} AND revoked_at IS NULL`;
  const token = qrRow!.token as string;

  // Guest 1 scans (no account)
  const ani = await (await browser.newContext()).newPage();
  await ani.goto(`/t/${token}`);
  await expect(ani).toHaveURL("/table");
  await expect(ani.getByRole("heading", { name: "Սեղան 1" })).toBeVisible();
  await expect(ani.getByText("Սկան Ռեստորան · Կենտրոն")).toBeVisible();
  const code = (await ani.getByText(/Այց #/).textContent())!.split("#")[1];

  // Refresh keeps the table
  await ani.reload();
  await expect(ani.getByRole("heading", { name: "Սեղան 1" })).toBeVisible();

  // Guest 2 at the same table joins the same session; English phone gets English
  const bobContext = await browser.newContext({ locale: "en-US" });
  const bob = await bobContext.newPage();
  await bob.goto(`/t/${token}`);
  await expect(bob).toHaveURL("/en/table");
  await expect(bob.getByRole("heading", { name: "Table 1" })).toBeVisible();
  await expect(bob.getByText(`Visit #${code}`)).toBeVisible();
  const [membersRow] = await sql`
    SELECT count(*)::int AS members FROM table_session_members m
    JOIN table_sessions s ON s.id = m.session_id WHERE s.restaurant_id = ${restaurantId} AND s.status = 'open'`;
  expect(membersRow!.members).toBe(2);

  // Someone who never scanned sees the scan prompt, not anyone's table
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto("/table");
  await expect(
    stranger.getByRole("heading", { name: "Սկանավորեք ձեր սեղանի QR կոդը" }),
  ).toBeVisible();

  // Replaced and made-up codes don't work
  await page.goto(`/dashboard/r/${restaurantId}/tables`);
  await page.getByRole("button", { name: "1 սեղանի QR կոդը" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Փոխարինել կոդը" }).click();
  await expect(page.getByText("Նոր QR կոդը ստեղծված է։ Տպեք այն սեղանի համար։")).toBeVisible();

  await stranger.goto(`/t/${token}`);
  await expect(stranger).toHaveURL("/table/unavailable");
  await expect(stranger.getByRole("heading", { name: "Այս QR կոդն ակտիվ չէ" })).toBeVisible();
  await stranger.goto("/t/AAAAAAAAAAAAAAAAAAAAAA");
  await expect(stranger).toHaveURL("/table/unavailable");
  await bobContext.close();
});
