import { expect, sql, test } from "./fixtures";
import {
  expectAccessible,
  seedBookableRestaurant,
  setupActiveTable,
  tomorrowInYerevan,
} from "./helpers";

/** §19–20: a guest finds a free time, signs up, holds it and books it. */
test("guest books a table; the time disappears for others", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const { slug, restaurantId } = await seedBookableRestaurant();
  const date = tomorrowInYerevan();
  const reservePath = `/r/${slug}/center/reserve?date=${date}&party=2`;

  // Signed out: times are shown, picking one asks to sign in.
  await page.goto(reservePath);
  await expect(page.getByRole("heading", { name: "Արարատ" })).toBeVisible();
  await expect(page.getByText("Ամրագրելու համար մուտք գործեք։")).toBeVisible();
  await expectAccessible(page, "booking page (signed out)");
  await page.getByRole("link", { name: "12:00" }).click();
  await expect(page).toHaveURL(/\/login\?next=/);

  // New guest registers and comes straight back to the same date and party.
  await page.getByRole("link", { name: "Ստեղծել հաշիվ" }).click();
  await page.getByLabel("Անուն").fill("Աննա");
  await page.getByLabel("Էլ. փոստ").fill(`guest-${Date.now()}@example.am`);
  await page.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL(reservePath);

  // Hold 12:00, then book it.
  await page.getByRole("button", { name: "Ընտրել 12:00" }).click();
  await expect(page.getByRole("heading", { name: "Ժամը 12:00 պահված է ձեզ համար" })).toBeVisible();
  await expect(page.getByLabel("Անուն")).toHaveValue("Աննա");
  await expectAccessible(page, "booking contact form");
  await page.getByRole("button", { name: "Ամրագրել" }).click();
  await expect(page.getByLabel("Հեռախոս")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Հեռախոս").fill("+374 91 123456");
  await page.getByLabel("Նշում (ոչ պարտադիր)").fill("Ծննդյան օր");
  await page.getByRole("button", { name: "Ամրագրել" }).click();

  await expect(page).toHaveURL(/\/reservations\?created=/);
  await expect(page.getByRole("status")).toHaveText(
    "Հարցումն ուղարկված է։ Ռեստորանը շուտով կհաստատի այն։",
  );
  const booking = page.getByRole("listitem").filter({ hasText: "Արարատ" });
  await expect(booking.getByText("Սպասում է հաստատման")).toBeVisible();
  await expect(booking.getByText("2 հյուր")).toBeVisible();
  await expectAccessible(page, "my reservations");

  const rows = await sql`
    SELECT status, party_size, contact_phone, note FROM reservations WHERE restaurant_id = ${restaurantId}`;
  expect(rows).toEqual([
    {
      status: "pending_confirmation",
      party_size: 2,
      contact_phone: "+37491123456",
      note: "Ծննդյան օր",
    },
  ]);

  // The only table is taken 12:00–14:00: overlapping times are gone for others.
  const other = await browser.newPage();
  await other.goto(reservePath);
  await expect(other.getByRole("link", { name: "14:00" })).toBeVisible();
  for (const taken of ["11:00", "12:00", "13:30"]) {
    await expect(other.getByRole("link", { name: taken, exact: true })).toHaveCount(0);
  }

  // The guest cancels; the time is free again.
  page.once("dialog", (dialog) => dialog.accept());
  await booking.getByRole("button", { name: "Չեղարկել Արարատ-ի ամրագրումը" }).click();
  await expect(booking.getByText("Չեղարկված")).toBeVisible();
  await expect(booking.getByRole("button", { name: /Չեղարկել/ })).toHaveCount(0);
  await other.reload();
  await expect(other.getByRole("link", { name: "12:00", exact: true })).toBeVisible();
  await other.close();
});

/** Owner turns reservations on, shares the link and sees the booking come in. */
test("owner sets up reservations and sees bookings on the dashboard", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { restaurantId, locationId } = await setupActiveTable(page, "Ամրագրման Ռեստորան");
  const day = [{ open: "10:00", close: "22:00" }];
  const hours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
  await sql`UPDATE restaurant_locations SET opening_hours = ${sql.json(hours)} WHERE id = ${locationId}`;

  // Before: the tab explains reservations are off.
  await page.goto(`/dashboard/r/${restaurantId}/reservations`);
  await expect(page.getByText("Այս մասնաճյուղը դեռ ամրագրումներ չի ընդունում։")).toBeVisible();
  await page.getByRole("link", { name: "Միացրեք մասնաճյուղի կարգավորումներում" }).click();

  // Place the location's pin by tapping the map.
  const picker = page.getByRole("region", { name: "Ընտրեք վայրը քարտեզի վրա" });
  await expect(picker.locator("canvas")).toBeVisible();
  await expect(page.getByLabel("Լայնություն")).toHaveValue("");
  await expect(async () => {
    await picker.locator("canvas").click({ position: { x: 120, y: 80 } });
    await expect(page.getByLabel("Լայնություն")).toHaveValue(/^\d+\.\d{6}$/, { timeout: 1_000 });
  }).toPass();
  await expect(page.getByLabel("Երկայնություն")).toHaveValue(/^\d+\.\d{6}$/);

  await page.getByLabel("Ընդունել սեղանի ամրագրումներ").check();
  await expect(page.getByLabel("Նոր ամրագրումներ")).toHaveValue("manual");
  await page.getByLabel("Սեղանը պահվում է").selectOption("90");
  await page.getByRole("button", { name: "Պահպանել մասնաճյուղը" }).click();
  await expect(page.getByText("Մասնաճյուղը պահպանված է։")).toBeVisible();
  const link = page.getByTestId("booking-url");
  await expect(link).toHaveValue(/\/r\/[a-z0-9-]+\/[a-z0-9-]+\/reserve$/);
  await expectAccessible(page, "location settings with reservations");
  const bookingPath = new URL(await link.inputValue()).pathname;

  // A guest books through the shared link; staff confirm each request.
  const date = tomorrowInYerevan();
  const guest = await (await browser.newContext()).newPage();
  const reservePath = `${bookingPath}?date=${date}&party=3`;
  await guest.goto(`/register?next=${encodeURIComponent(reservePath)}`);
  await guest.getByLabel("Անուն").fill("Գոռ");
  await guest.getByLabel("Էլ. փոստ").fill(`gor-${Date.now()}@example.am`);
  await guest.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await guest.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(guest).toHaveURL(reservePath);
  await guest.getByRole("button", { name: "Ընտրել 19:00" }).click();
  await guest.getByLabel("Հեռախոս").fill("091 22 33 44");
  await guest.getByRole("button", { name: "Ամրագրել" }).click();
  await expect(guest.getByRole("status")).toHaveText(
    "Հարցումն ուղարկված է։ Ռեստորանը շուտով կհաստատի այն։",
  );
  // …and asks for a second, later table the same evening.
  await guest.goto(reservePath);
  await guest.getByRole("button", { name: "Ընտրել 13:00" }).click();
  await guest.getByLabel("Հեռախոս").fill("091 22 33 44");
  await guest.getByRole("button", { name: "Ամրագրել" }).click();
  await expect(guest).toHaveURL(/created=/);

  // The owner sees it on that day, with contact details.
  await page.goto(`/dashboard/r/${restaurantId}/reservations?location=${locationId}&date=${date}`);
  const bookings = page.getByRole("list", { name: "Ամրագրումներ" }).getByRole("listitem");
  await expect(bookings).toHaveCount(2);
  await expect(page.getByText("հաստատման է սպասում՝ 2")).toBeVisible();

  // Decline the 13:00 request with a reason the guest will see.
  const lunch = bookings.filter({ hasText: "13:00–14:30" });
  await lunch.getByRole("button", { name: "Մերժել Գոռ-ի հարցումը" }).click();
  const dialog = page.getByRole("dialog", { name: "Մերժե՞լ Գոռ-ի հարցումը" });
  await expect(dialog.getByRole("button", { name: "Մերժել" })).toBeDisabled();
  await dialog.getByLabel("Պատճառ").fill("Ցերեկը փակ միջոցառում է");
  await dialog.getByRole("button", { name: "Մերժել" }).click();
  await expect(lunch).toContainText("Չեղարկված");

  const booking = bookings.filter({ hasText: "19:00–20:30" });
  await booking.getByRole("button", { name: "Հաստատել Գոռ-ի ամրագրումը" }).click();
  await expect(booking).toContainText("Հաստատված");
  await expect(booking).toContainText("Սեղան 1");
  await expect(booking).toContainText("Գոռ");
  await expect(booking).toContainText("3 հյուր");
  await expect(booking.getByRole("link", { name: "091223344" })).toHaveAttribute(
    "href",
    "tel:091223344",
  );
  await expect(page.getByText("1 ամրագրում, 3 հյուր")).toBeVisible();
  await expectAccessible(page, "staff reservations");

  // Guests arrive, sit, and leave; each step is a button.
  await booking.getByRole("button", { name: "Գոռ-ը ժամանեց" }).click();
  await expect(booking).toContainText("Ժամանել է");
  await booking.getByRole("button", { name: "Գոռ-ը նստեց" }).click();
  await expect(booking).toContainText("Նստած է");
  await booking.getByRole("button", { name: "Ավարտել Գոռ-ի այցը և ազատել սեղանը" }).click();
  await expect(booking).toContainText("Ավարտված");
  // Nothing left to do with a finished booking except rate the guest (two-way reviews).
  await expect(booking.getByRole("button")).toHaveCount(1);
  await expect(booking.getByRole("button", { name: "Գնահատել Գոռ-ին" })).toBeVisible();

  // The guest sees the decline reason.
  await guest.goto("/reservations");
  await expect(guest.getByText("Պատճառ՝ Ցերեկը փակ միջոցառում է")).toBeVisible();

  // Day navigation: the next day is empty.
  await page.getByRole("link", { name: "Հաջորդ օր" }).click();
  await expect(page.getByText("Այս օրը ամրագրումներ չկան։")).toBeVisible();

  // Require a deposit per booking, refundable until 48 hours ahead.
  await page.goto(`/dashboard/r/${restaurantId}/locations/${locationId}`);
  await page.getByLabel("Կանխավճար", { exact: true }).selectOption("per_booking");
  const amount = page.getByLabel("Կանխավճար մեկ ամրագրման համար (AMD)");
  await page.getByRole("button", { name: "Պահպանել մասնաճյուղը" }).click();
  await expect(page.getByText("Մուտքագրեք կանխավճարի գումարը։")).toBeVisible();
  await amount.fill("5000");
  await page.getByLabel("Վերադարձ, եթե հյուրը չեղարկի").selectOption("48");
  await page.getByRole("button", { name: "Պահպանել մասնաճյուղը" }).click();
  await expect(page.getByText("Մասնաճյուղը պահպանված է։")).toBeVisible();
  const [saved] = await sql`
    SELECT reservation_deposit_type, reservation_deposit_minor, reservation_refund_cutoff_hours
    FROM restaurant_locations WHERE id = ${locationId}`;
  expect(saved).toEqual({
    reservation_deposit_type: "per_booking",
    reservation_deposit_minor: 500000,
    reservation_refund_cutoff_hours: 48,
  });
  await expectAccessible(page, "location deposit settings");
});

/** §19: the scheduled job needs the cron secret and expires unanswered requests. */
test("the cron job is protected and expires unanswered requests", async ({ request }) => {
  const { restaurantId } = await seedBookableRestaurant();
  const [table] =
    await sql`SELECT id, location_id FROM tables WHERE restaurant_id = ${restaurantId}`;
  const [reservation] = await sql`
    INSERT INTO reservations (restaurant_id, location_id, table_id, party_size, starts_at, ends_at,
      status, contact_name, contact_phone)
    VALUES (${restaurantId}, ${table!.location_id}, ${table!.id}, 2, now() - interval '1 hour',
      now() + interval '1 hour', 'pending_confirmation', 'Anna', '+37491000000')
    RETURNING id`;
  await sql`
    INSERT INTO reservation_holds (restaurant_id, table_id, reservation_id, starts_at, ends_at, expires_at)
    VALUES (${restaurantId}, ${table!.id}, ${reservation!.id}, now() - interval '1 hour',
      now() + interval '1 hour', now() - interval '1 hour')`;

  expect((await request.get("/api/cron/reservations")).status()).toBe(401);
  const wrong = await request.get("/api/cron/reservations", {
    headers: { authorization: "Bearer not-the-secret" },
  });
  expect(wrong.status()).toBe(401);

  const run = await request.get("/api/cron/reservations", {
    headers: { authorization: "Bearer e2e-cron-secret-0123456789" },
  });
  expect(run.status()).toBe(200);
  const { data } = await run.json();
  expect(data.expiredReservations).toBeGreaterThanOrEqual(1);
  const [after] = await sql`SELECT status FROM reservations WHERE id = ${reservation!.id}`;
  expect(after!.status).toBe("expired");
});

/** §19/§21: a booking with a deposit is confirmed only after the payment is verified. */
test("guest pays a deposit to confirm, retries a declined card, and gets it back on cancelling", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { slug, restaurantId } = await seedBookableRestaurant();
  await sql`
    UPDATE restaurant_locations
    SET reservation_deposit_type = 'per_guest', reservation_deposit_minor = 200000,
        reservation_confirmation = 'auto', reservation_refund_cutoff_hours = 0
    WHERE restaurant_id = ${restaurantId}`;
  const date = tomorrowInYerevan();
  const reservePath = `/r/${slug}/center/reserve?date=${date}&party=3`;

  await page.goto(`/register?next=${encodeURIComponent(reservePath)}`);
  await page.getByLabel("Անուն").fill("Լիլիթ");
  await page.getByLabel("Էլ. փոստ").fill(`lilit-${Date.now()}@example.am`);
  await page.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL(reservePath);

  // 2 000 ֏ × 3 guests, paid on the provider's page.
  await page.getByRole("button", { name: "Ընտրել 12:00" }).click();
  await page.getByLabel("Հեռախոս").fill("+374 93 112233");
  await expect(page.getByText(/հիմա վճարվում է 6.000.֏ կանխավճար/)).toBeVisible();
  await page.getByRole("button", { name: /Ամրագրել և վճարել 6.000.֏/ }).click();
  await expect(page).toHaveURL(/\/dev\/pay\/fake_/);
  await expect(page.getByRole("heading", { name: "Փորձնական վճարում" })).toBeVisible();
  await page.getByRole("button", { name: "Վճարել" }).click();

  await expect(page).toHaveURL(/\/reservations\?created=/);
  await expect(page.getByRole("status")).toHaveText("Ամրագրումը հաստատված է։");
  const booking = page.getByRole("listitem").filter({ hasText: "12:00" });
  await expect(booking.getByText(/Կանխավճար 6.000.֏ · վճարված է/)).toBeVisible();
  await expectAccessible(page, "my reservations with a deposit");

  // A second booking: the card is declined, then paid on the second try.
  await page.goto(reservePath);
  await page.getByRole("button", { name: "Ընտրել 15:00" }).click();
  await page.getByLabel("Հեռախոս").fill("+374 93 112233");
  await page.getByRole("button", { name: /Ամրագրել և վճարել/ }).click();
  await page.getByRole("button", { name: "Մերժել" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Սեղանը պահված է, բայց կանխավճարը դեռ վճարված չէ։ Վճարեք՝ ամրագրումը պահպանելու համար։",
  );
  const unpaid = page.getByRole("listitem").filter({ hasText: "15:00" });
  await expect(unpaid.getByText("Սպասում է վճարման")).toBeVisible();
  await unpaid.getByRole("button", { name: /Վճարել կանխավճարը/ }).click();
  await page.getByRole("button", { name: "Վճարել" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "15:00" })).toContainText("Հաստատված");

  // Cancelling in time refunds the deposit.
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Կանխավճարը կվերադարձվի։");
    void dialog.accept();
  });
  await booking.getByRole("button", { name: /Չեղարկել/ }).click();
  await expect(booking.getByText(/Կանխավճար 6.000.֏ · վերադարձված է/)).toBeVisible();

  const payments = await sql`
    SELECT p.status, p.refunded_minor FROM payments p
    JOIN reservations r ON r.id = p.reservation_id
    WHERE r.restaurant_id = ${restaurantId} ORDER BY p.created_at`;
  expect(payments.map((p) => p.status)).toEqual(["refunded", "failed", "succeeded"]);
});
