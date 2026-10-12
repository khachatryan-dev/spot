import { expect, sql, test } from "./fixtures";
import { expectAccessible, setupActiveTable, tomorrowInYerevan } from "./helpers";

/** §27: staff hear about a booking request; the guest hears it was confirmed. */
test("booking notifications reach the owner and the guest", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { restaurantId, locationId } = await setupActiveTable(page, "Ծանուցումների Ռեստորան");
  const day = [{ open: "10:00", close: "22:00" }];
  const hours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
  await sql`
    UPDATE restaurant_locations SET opening_hours = ${sql.json(hours)}, reservations_enabled = true
    WHERE id = ${locationId}`;
  const [slugs] = await sql`
    SELECT r.slug AS restaurant, l.slug AS location FROM restaurant_locations l
    JOIN restaurants r ON r.id = l.restaurant_id WHERE l.id = ${locationId}`;

  // A guest books (the location confirms by hand).
  const guest = await (await browser.newContext()).newPage();
  const date = tomorrowInYerevan();
  const reservePath = `/r/${slugs!.restaurant}/${slugs!.location}/reserve?date=${date}&party=2`;
  const email = `mane-${Date.now()}@example.am`;
  await guest.goto(`/register?next=${encodeURIComponent(reservePath)}`);
  await guest.getByLabel("Անուն").fill("Մանե");
  await guest.getByLabel("Էլ. փոստ").fill(email);
  await guest.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await guest.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(guest).toHaveURL(reservePath);
  await guest.getByRole("button", { name: "Ընտրել 13:00" }).click();
  await guest.getByLabel("Հեռախոս").fill("+374 94 445566");
  await guest.getByRole("button", { name: "Ամրագրել" }).click();
  await expect(guest).toHaveURL(/\/reservations\?created=/);

  // The owner's bell shows it; the notice links to that day's bookings.
  await page.goto(`/dashboard/r/${restaurantId}`);
  await page.getByRole("link", { name: "Ծանուցումներ, նոր՝ 1" }).click();
  await expect(page).toHaveURL("/notifications");
  const notice = page.getByRole("list", { name: "Ծանուցումներ" }).getByRole("link");
  await expect(notice).toContainText("Ամրագրման նոր հարցում՝ Մանե, 2 հյուր");
  await expectAccessible(page, "notifications");
  await notice.click();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/r/${restaurantId}/reservations\\?location=.*date=${date}`),
  );
  await page.getByRole("button", { name: "Հաստատել Մանե-ի ամրագրումը" }).click();
  await expect(page.getByRole("list", { name: "Ամրագրումներ" })).toContainText("Հաստատված");
  await page.goto(`/dashboard/r/${restaurantId}`);
  await expect(page.getByRole("link", { name: "Ծանուցումներ", exact: true })).toBeVisible();

  // The guest's bell and page show the confirmation; the header still fits a phone.
  await guest.goto("/");
  await expect(guest.getByRole("button", { name: "EN" })).toBeInViewport({ ratio: 1 });
  await guest.getByRole("link", { name: "Ծանուցումներ, նոր՝ 1" }).click();
  await expect(guest.getByRole("list", { name: "Ծանուցումներ" })).toContainText(
    "Ծանուցումների Ռեստորան-ը հաստատեց ձեր սեղանը",
  );

  // Emails were written to the outbox (logged: no email service yet).
  const emails =
    await sql`SELECT template, status FROM email_messages WHERE "to" = ${email} ORDER BY created_at`;
  expect(emails).toEqual([
    { template: "reservation_received", status: "logged" },
    { template: "reservation_confirmed", status: "logged" },
  ]);
});
