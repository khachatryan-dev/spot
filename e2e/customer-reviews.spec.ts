import { expect, sql, test } from "./fixtures";
import { expectAccessible, setupActiveTable } from "./helpers";

/** Two-way reviews: the restaurant rates a guest after a booking; the guest sees it. */
test("a restaurant rates a guest after a booking, and the guest sees it in their profile", async ({
  page,
  browser,
}) => {
  const { restaurantId, locationId } = await setupActiveTable(page, "Գնահատող Ռեստորան");

  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.emulateMedia({ reducedMotion: "reduce" });
  const email = `lilit-${Date.now()}@example.am`;
  await guest.goto("/register");
  await guest.getByLabel("Անուն").fill("Լիլիթ");
  await guest.getByLabel("Էլ. փոստ").fill(email);
  await guest.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await guest.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(guest).toHaveURL("/home");
  await guest.goto("/account");
  await expect(
    guest.getByRole("region", { name: "Ինչ են ասում ռեստորանները ձեր մասին" }),
  ).toContainText("Այցերից հետո ռեստորանները կարող են գնահատել ձեզ");

  // A booking that ended an hour ago (seeded directly; reservations.spec covers completing one).
  const startsAt = new Date(Date.now() - 3 * 3_600_000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yerevan" }).format(startsAt);
  const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
  const [table] = await sql`SELECT id FROM tables WHERE restaurant_id = ${restaurantId}`;
  await sql`
    INSERT INTO reservations (restaurant_id, location_id, table_id, customer_user_id, party_size,
      starts_at, ends_at, status, completed_at, contact_name, contact_phone)
    VALUES (${restaurantId}, ${locationId}, ${table!.id}, ${user!.id}, 2,
      ${startsAt}, ${new Date(startsAt.getTime() + 2 * 3_600_000)}, 'completed', now(),
      'Լիլիթ', '+37491000000')`;

  // The owner rates the guest from the bookings list.
  await page.goto(`/dashboard/r/${restaurantId}/reservations?location=${locationId}&date=${day}`);
  const booking = page.getByRole("list", { name: "Ամրագրումներ" }).getByRole("listitem");
  await booking.getByRole("button", { name: "Գնահատել Լիլիթ-ին" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("label").filter({ hasText: "5 աստղ" }).click();
  await expect(dialog.getByRole("radio", { name: "5 աստղ" })).toBeChecked();
  await dialog
    .getByLabel("Մեկնաբանություն (ոչ պարտադիր)")
    .fill("Եկավ ժամանակին, շատ բարեհամբույր էր");
  await dialog.getByRole("button", { name: "Պահպանել գնահատականը" }).click();
  await expect(page.getByText("Գնահատականը պահպանված է։")).toBeVisible();
  await expect(booking.getByRole("button", { name: "Փոխել Լիլիթ-ի գնահատականը" })).toBeVisible();
  await expect(booking).toContainText("★ 5.0 · 1 գնահատական այստեղ");
  await expectAccessible(page, "bookings with a guest rating");

  // The guest sees it in their profile.
  await guest.reload();
  const rated = guest.getByRole("region", { name: "Ինչ են ասում ռեստորանները ձեր մասին" });
  await expect(rated).toContainText("Գնահատող Ռեստորան");
  await expect(rated).toContainText("Եկավ ժամանակին, շատ բարեհամբույր էր");
  await expect(rated).toContainText("Միջինը՝ 5.0, 1 գնահատական");
  await expectAccessible(guest, "profile with a restaurant rating");
  await context.close();
});
