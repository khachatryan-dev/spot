import { expect, sql, test, type Browser } from "./fixtures";
import { expectAccessible } from "./helpers";

const PASSWORD = "correct horse battery";

async function registerIn(browser: Browser, name: string, email: string, path = "/register") {
  const page = await (await browser.newContext()).newPage();
  await page.goto(path);
  await page.getByLabel("Անուն").fill(name);
  await page.getByLabel("Էլ. փոստ").fill(email);
  await page.getByLabel("Գաղտնաբառ").fill(PASSWORD);
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  return page;
}

/**
 * The restaurant's side of the first production target (§56), all through the
 * UI: an owner signs in, builds a menu, sets up a table with a QR code, gets
 * approved, invites a cook; a guest orders and the order goes through the
 * kitchen to the table. Phone viewport, Armenian, accessibility checks on
 * every staff screen.
 */
test("a restaurant from signing in to serving its first order", async ({ page, browser }) => {
  test.setTimeout(150_000); // the whole setup plus two live-update waits
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ownerEmail = `owner-${stamp}@example.am`;

  // --- 1. Owner account: register, sign out, sign back in
  await page.goto("/register");
  await page.getByLabel("Անուն").fill("Արամ");
  await page.getByLabel("Էլ. փոստ").fill(ownerEmail);
  await page.getByLabel("Գաղտնաբառ").fill(PASSWORD);
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Ելք" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/dashboard");
  await expect(page).toHaveURL("/login?next=%2Fdashboard");
  await page.getByLabel("Էլ. փոստ").fill(ownerEmail);
  await page.getByLabel("Գաղտնաբառ").fill(PASSWORD);
  await page.getByRole("button", { name: "Մուտք գործել" }).click();
  await expect(page).toHaveURL("/dashboard");

  // --- 2. Restaurant and location
  await page.getByRole("link", { name: "Ստեղծել ռեստորան" }).click();
  await page.getByLabel("Ռեստորանի անվանումը").fill("Արարատ Խորովածանոց");
  await page.getByRole("button", { name: "Ստեղծել ռեստորան" }).click();
  await expect(page).toHaveURL(/\/dashboard\/r\/[0-9a-f-]{36}$/);
  const restaurantId = page.url().split("/").pop()!;
  await page.getByLabel("Մասնաճյուղի անվանումը").fill("Կենտրոն");
  await page.getByLabel("Հասցե").fill("Աբովյան 1");
  await page.getByRole("button", { name: "Ավելացնել մասնաճյուղ" }).click();
  await expect(page.getByText("Աբովյան 1, Երևան")).toBeVisible();
  await expectAccessible(page, "the restaurant overview");

  // --- 3. Menu: a category and an item with a required size
  await page.getByRole("link", { name: "Մենյու", exact: true }).click();
  await page.getByRole("button", { name: "Ստեղծել մենյու" }).click();
  await expect(page.getByRole("checkbox", { name: "Կենտրոն" })).toBeChecked();
  await page.getByLabel("Նոր բաժնի անվանումը").fill("Խորոված");
  await page.getByRole("button", { name: "Ավելացնել բաժին" }).click();
  await expectAccessible(page, "the menu editor");

  await page.getByRole("link", { name: "Ավելացնել ուտեստ՝ Խորոված" }).click();
  await page.getByLabel("Անվանում", { exact: true }).fill("Խոզի խորոված");
  await page.getByLabel("Գին (AMD)").fill("4500");
  await page.getByLabel("Բաղադրություն").fill("Խոզի չալաղաջ, սոխ, լավաշ");
  await page.getByRole("button", { name: "Ստեղծել ուտեստ" }).click();
  await expect(page.getByRole("heading", { name: "Խոզի խորոված" })).toBeVisible();
  await page.getByLabel("Ընտրանքների խումբ").fill("Չափաբաժին");
  await page.getByRole("button", { name: "Ավելացնել խումբ" }).click();
  const portion = page.getByRole("group", { name: "Չափաբաժին" });
  await portion.getByLabel("Նոր ընտրանք՝ Չափաբաժին").fill("Սովորական");
  await portion.getByRole("button", { name: "Ավելացնել ընտրանք" }).click();
  await expect(portion.getByText("Անվճար")).toBeVisible();
  await portion.getByLabel("Նոր ընտրանք՝ Չափաբաժին").fill("Կրկնակի");
  await portion.getByLabel("Հավելյալ գին՝ Չափաբաժին (AMD)").fill("4000");
  await portion.getByRole("button", { name: "Ավելացնել ընտրանք" }).click();
  await expect(portion.getByText("+4 000 ֏")).toBeVisible();
  await expectAccessible(page, "the item editor");

  // --- 4. Table 1 with a QR code
  await page.getByRole("link", { name: "Սեղաններ", exact: true }).click();
  await expect(page).toHaveURL(`/dashboard/r/${restaurantId}/tables`);
  const addRange = page.getByRole("button", { name: "Ավելացնել 1–1 սեղանները" });
  // A fill during the page's first render can be overwritten; retry until it sticks.
  await expect(async () => {
    await page.getByLabel("Մինչև").fill("1");
    await expect(addRange).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await addRange.click();
  await page.getByRole("button", { name: "Ստեղծել QR կոդեր" }).click();
  await expect(page.getByText("Բոլոր սեղաններն ունեն QR կոդ։")).toBeVisible();
  await expectAccessible(page, "the tables page");
  await page.getByRole("button", { name: "1 սեղանի QR կոդը" }).click();
  const qrUrl = page.getByRole("dialog").getByTestId("qr-url");
  await expect(qrUrl).toHaveText(/\/t\/[A-Za-z0-9_-]{22}$/);
  const token = (await qrUrl.textContent())!.split("/t/")[1]!;
  await page.keyboard.press("Escape");

  // --- 5. Review: submit, a platform admin approves
  await page.goto(`/dashboard/r/${restaurantId}`);
  await page.getByRole("button", { name: "Ուղարկել ստուգման" }).click();
  await expect(page.getByText("Ստուգման մեջ").first()).toBeVisible();

  const adminEmail = `admin-${stamp}@example.am`;
  const admin = await registerIn(browser, "Ադմին", adminEmail);
  await expect(admin).toHaveURL("/");
  await sql`UPDATE users SET platform_role = 'platform_admin' WHERE email = ${adminEmail}`;
  await admin.goto(`/admin/restaurants/${restaurantId}`);
  await admin.getByRole("button", { name: "Հաստատել" }).click();
  await expect(admin.getByText("Ռեստորանը հաստատված է․ այժմ հասանելի է բոլորին։")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Ակտիվ")).toBeVisible();

  // --- 6. Team: invite a cook by link
  await page.getByRole("link", { name: "Թիմ", exact: true }).click();
  const cookEmail = `cook-${stamp}@example.am`;
  await page.getByLabel("Էլ. փոստ").fill(cookEmail);
  await page.getByLabel("Դեր", { exact: true }).selectOption("kitchen");
  await page.getByRole("button", { name: "Ստեղծել հրավերի հղում" }).click();
  const inviteInput = page.getByRole("textbox", { name: "Հրավերի հղում" });
  await expect(inviteInput).toHaveValue(/\/invite\/[A-Za-z0-9_-]{43}$/);
  await expectAccessible(page, "the team page");
  const invitePath = new URL(await inviteInput.inputValue()).pathname;

  const cook = await registerIn(
    browser,
    "Գոռ",
    cookEmail,
    `/register?next=${encodeURIComponent(invitePath)}`,
  );
  await expect(cook).toHaveURL(invitePath);
  await cook.getByRole("button", { name: "Ընդունել հրավերը" }).click();
  await expect(cook).toHaveURL(`/dashboard/r/${restaurantId}`);
  await cook
    .getByRole("navigation", { name: "Ռեստորանի բաժիններ" })
    .getByRole("link", { name: "Խոհանոց" })
    .click();
  await expect(cook.getByText("Ամեն ինչ պատրաստ է․ պատրաստելու պատվերներ չկան։")).toBeVisible();
  await expectAccessible(cook, "the kitchen screen");

  // --- 7. The owner watches the order board; a guest orders
  await page.goto(`/dashboard/r/${restaurantId}/orders`);
  await expectAccessible(page, "the order board");

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  await expect(guest.getByRole("heading", { name: "Սեղան 1" })).toBeVisible();
  await guest.getByRole("article", { name: "Խոզի խորոված" }).getByRole("button").click();
  const sheet = guest.getByRole("dialog", { name: "Խոզի խորոված" });
  await sheet.getByRole("radio", { name: /Կրկնակի/ }).check();
  await sheet.getByRole("button", { name: "Ավելացնել · 8 500 ֏" }).click();
  await guest.getByRole("button", { name: /Դիտել պատվերը/ }).click();
  await guest.getByRole("button", { name: "Պատվիրել" }).click();
  await expect(guest).toHaveURL(/\/table\/orders\?placed=/);
  const myOrder = guest.getByRole("list", { name: "Իմ պատվերները" }).getByRole("listitem").first();
  await expect(myOrder).toContainText("1 × Խոզի խորոված · Կրկնակի");

  // The board picks it up by itself (no reload)
  await expect(page.getByText("Սեղան 1").first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("main")).toContainText("8 500 ֏");

  // --- 8. Kitchen: accept → preparing → ready
  const ticket = cook.getByRole("article", { name: "Սեղան 1, պատվեր #1" });
  await expect(ticket).toContainText("1 × Խոզի խորոված", { timeout: 25_000 });
  await expect(ticket).toContainText("Կրկնակի");
  await ticket.getByRole("button", { name: "Ընդունել #1 պատվերը" }).click();
  await ticket.getByRole("button", { name: "Սկսել պատրաստել #1 պատվերը" }).click();
  await ticket.getByRole("button", { name: "Պատրաստ է #1 պատվերը" }).click();
  await expect(cook.getByRole("list", { name: "Պատրաստ է, սպասում է մատուցողին" })).toContainText(
    "Սեղան 1 · #1",
  );

  // --- 9. Served: the owner takes it to the table; the guest sees it
  await page.reload();
  await page.getByRole("button", { name: "Մատուցված է #1 պատվերը" }).click();
  await expect(page.getByRole("button", { name: "Մատուցված է #1 պատվերը" })).toHaveCount(0);
  await expect(myOrder).toContainText("Մատուցված է", { timeout: 25_000 });

  const [order] =
    await sql`SELECT status, total_minor FROM orders WHERE restaurant_id = ${restaurantId}`;
  expect(order).toEqual({ status: "served", total_minor: 850000 });
});
