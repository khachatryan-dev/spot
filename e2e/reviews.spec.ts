import { expect, sql, test } from "./fixtures";
import { expectAccessible, seedMenu, setupActiveTable } from "./helpers";

/** §24: only a guest who was really served can review; the review shows publicly at once. */
test("a guest reviews their visit and it appears on the restaurant's page", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const { restaurantId, locationId, token } = await setupActiveTable(page, "Կարծիքների Ռեստորան");
  const { categoryId } = await seedMenu(restaurantId, locationId, "Ըմպելիքներ");
  await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, price_minor)
    VALUES (${restaurantId}, ${categoryId}, 'Սուրճ', 120000)`;

  // An anonymous guest orders a coffee and is served.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/t/${token}`);
  await guest.getByRole("article", { name: "Սուրճ" }).getByRole("button").click();
  await guest
    .getByRole("dialog", { name: "Սուրճ" })
    .getByRole("button", { name: /^Ավելացնել · / })
    .click();
  await guest.getByRole("button", { name: /Դիտել պատվերը/ }).click();
  await guest.getByRole("button", { name: "Պատվիրել" }).click();
  await expect(guest).toHaveURL(/\/table\/orders\?placed=/);
  await sql`UPDATE orders SET status = 'served' WHERE restaurant_id = ${restaurantId}`;

  // Nothing to review while the visit is on.
  await guest.goto("/reviews");
  await expect(guest.getByText(/Գնահատելու այցեր հիմա չկան/)).toBeVisible();

  // Staff close the visit; the guest is invited to rate it.
  await page.goto(`/dashboard/r/${restaurantId}/tables`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Փակել 1 սեղանի այցը" }).click();
  await expect(page.getByText("Այցը փակված է։ Սեղանն ազատ է։")).toBeVisible();
  await guest.goto("/table");
  await guest.getByRole("link", { name: "Գնահատեք ձեր այցը Կարծիքների Ռեստորան" }).click();
  await expect(guest).toHaveURL("/reviews");

  const form = guest.getByRole("form", { name: /Ինչպե՞ս էր Կարծիքների Ռեստորան/ });
  await expectAccessible(guest, "review form");
  await form.getByRole("button", { name: "Հրապարակել կարծիքը" }).click();
  await expect(form.getByRole("alert")).toHaveText("Ընտրեք 1-ից 5 աստղ։");
  await form.locator("label").filter({ hasText: "4 աստղ" }).click();
  await expect(form.getByRole("radio", { name: "4 աստղ" })).toBeChecked();
  await form.getByLabel("Մեկնաբանություն (ոչ պարտադիր)").fill("Համեղ սուրճ, արագ սպասարկում");
  await form.getByRole("button", { name: "Հրապարակել կարծիքը" }).click();
  await expect(form.getByText("Նշեք ձեր էլ. փոստը։")).toBeVisible();
  await form.getByLabel("Էլ. փոստ").fill("Lilit@Example.am");
  await form.getByLabel("Ցուցադրվող անուն (ոչ պարտադիր)").fill("Լիլիթ");
  await form.getByRole("button", { name: "Հրապարակել կարծիքը" }).click();
  await expect(guest.getByText("Շնորհակալություն։ Ձեր կարծիքը հրապարակված է։")).toBeVisible();
  await expect(guest.getByText(/Գնահատելու այցեր հիմա չկան/)).toBeVisible();

  const [review] = await sql`
    SELECT rating, comment, author_email, display_name, status FROM reviews
    WHERE restaurant_id = ${restaurantId}`;
  expect(review).toEqual({
    rating: 4,
    comment: "Համեղ սուրճ, արագ սպասարկում",
    author_email: "lilit@example.am",
    display_name: "Լիլիթ",
    status: "published",
  });

  // Public: the restaurant's booking page shows the rating and the review, not the email.
  const [location] = await sql`
    SELECT r.slug AS restaurant, l.slug AS location FROM restaurant_locations l
    JOIN restaurants r ON r.id = l.restaurant_id WHERE l.id = ${locationId}`;
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/r/${location!.restaurant}/${location!.location}/reserve`);
  const reviews = visitor.getByRole("region", { name: "Կարծիքներ" });
  await expect(reviews.getByRole("img", { name: "Միջին գնահատական՝ 4՝ 5-ից" })).toBeVisible();
  await expect(reviews).toContainText("1 կարծիք");
  await expect(reviews).toContainText("Լիլիթ");
  await expect(reviews).toContainText("Համեղ սուրճ, արագ սպասարկում");
  await expect(reviews).not.toContainText("example.am");
  await expectAccessible(visitor, "public reviews");

  // The owner replies from the dashboard; the reply appears publicly.
  await page.getByRole("link", { name: "Կարծիքներ", exact: true }).click();
  await expect(page).toHaveURL(`/dashboard/r/${restaurantId}/reviews`);
  const item = page.getByRole("list", { name: "Կարծիքներ" }).getByRole("listitem");
  await expect(item).toContainText("Լիլիթ");
  await expect(item).toContainText("սեղանի այց");
  await item.getByRole("button", { name: "Պատասխանել" }).click();
  await item.getByLabel("Պատասխան Լիլիթ-ին").fill("Շնորհակալություն, սպասում ենք նորից։");
  await item.getByRole("button", { name: "Հրապարակել պատասխանը" }).click();
  await expect(page.getByText("Պատասխանը հրապարակված է։")).toBeVisible();
  await expectAccessible(page, "restaurant reviews");
  await visitor.reload();
  await expect(reviews).toContainText("Ռեստորանի պատասխանը՝ Շնորհակալություն, սպասում ենք նորից։");

  // Reporting sends it to moderation but keeps it visible.
  await item.getByRole("button", { name: "Բողոքարկել" }).click();
  const dialog = page.getByRole("dialog", { name: "Բողոքարկե՞լ Լիլիթ-ի կարծիքը" });
  await dialog.getByLabel("Պատճառ").fill("Թեստային բողոք մոդերացիայի համար");
  await dialog.getByRole("button", { name: "Բողոքարկել" }).click();
  await expect(page.getByText("Կարծիքը բողոքարկված է։")).toBeVisible();
  await expect(item).toContainText("Բողոքարկված");
  await visitor.reload();
  await expect(reviews).toContainText("Լիլիթ");

  // A platform admin moderates: hide with a reason, then restore.
  const adminEmail = `admin-${Date.now()}@example.am`;
  const admin = await (await browser.newContext()).newPage();
  await admin.goto("/register");
  await admin.getByLabel("Անուն").fill("Ադմին");
  await admin.getByLabel("Էլ. փոստ").fill(adminEmail);
  await admin.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await admin.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(admin).toHaveURL("/");
  await sql`UPDATE users SET platform_role = 'platform_admin' WHERE email = ${adminEmail}`;
  await admin.goto("/admin/reviews");
  const queue = admin.getByRole("region", { name: /Բողոքարկված/ });
  await expect(queue).toContainText("Ռեստորանի բողոքը՝ Թեստային բողոք մոդերացիայի համար");
  await expect(queue).toContainText("lilit@example.am"); // admins see the email
  await expectAccessible(admin, "admin review moderation");
  await queue.getByRole("button", { name: "Թաքցնել Լիլիթ-ի կարծիքը" }).click();
  const why = admin.getByRole("dialog", { name: "Թաքցնել Լիլիթ-ի կարծիքը" });
  await why.getByLabel("Պատճառ").fill("Թեստային թաքցում");
  await why.getByRole("button", { name: "Թաքցնել" }).click();
  await expect(admin.getByText("Որոշումը պահպանված է։")).toBeVisible();
  await expect(admin.getByText("Սպասող բողոքներ չկան։")).toBeVisible();

  await visitor.reload();
  await expect(visitor.getByRole("region", { name: "Կարծիքներ" })).toHaveCount(0);
  await page.reload();
  await expect(item).toContainText("Թաքցված");
  await expect(item).toContainText("Մոդերատորի նշումը՝ Թեստային թաքցում");

  const restore = admin
    .getByRole("region", { name: "Վերջին կարծիքները" })
    .getByRole("button", { name: "Վերականգնել Լիլիթ-ի կարծիքը" });
  await restore.click();
  await expect(restore).toHaveCount(0);
  await visitor.reload();
  await expect(reviews).toContainText("Լիլիթ");
});
