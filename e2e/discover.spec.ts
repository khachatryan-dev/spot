import { expect, sql, test } from "./fixtures";
import { expectAccessible } from "./helpers";

async function seed(
  name: string,
  values: { cuisines: string; price: number; city: string; at?: [number, number] },
) {
  const slug = `find-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const day = [{ open: "00:00", close: "23:59" }];
  const hours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
  const [r] = await sql`
    INSERT INTO restaurants (name, slug, status, cuisines, price_range, approved_at)
    VALUES (${name}, ${slug}, 'active', ${values.cuisines}::text[], ${values.price}, now())
    RETURNING id`;
  await sql`
    INSERT INTO restaurant_locations
      (restaurant_id, name, slug, address_line, city, opening_hours, reservations_enabled, latitude, longitude)
    VALUES (${r!.id}, 'Կենտրոն', 'center', 'Աբովյան 1', ${values.city}, ${sql.json(hours)}, true,
      ${values.at?.[0] ?? null}, ${values.at?.[1] ?? null})`;
  return slug;
}

/** §26: guests find restaurants by name (typos too), cuisine, price, city and open now. */
test("guests search and filter restaurants", async ({ page }) => {
  // Each name gets its own random tag, so earlier runs' data can't match.
  const tag = () => Math.random().toString(36).slice(2, 8);
  const zangak = `Զանգակ ${tag()}`;
  const tbilisi = `Թբիլիսի ${tag()}`;
  const city = `Դիլիջան ${tag()}`;
  const grill = await seed(zangak, { cuisines: "{armenian,grill}", price: 2, city });
  await seed(tbilisi, { cuisines: "{georgian}", price: 3, city });

  // From the home page search box.
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Որոնել ռեստորաններ" }).fill(zangak);
  await page.getByRole("button", { name: "Որոնել" }).click();
  await expect(page).toHaveURL(/\/restaurants\?q=/);
  const results = page.getByRole("list", { name: "Գտնված ռեստորաններ" });
  await expect(results.getByRole("heading", { name: zangak })).toBeVisible();
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expectAccessible(page, "restaurant search");
  // The header fits on a phone: the language switch is fully on screen.
  await expect(page.getByRole("button", { name: "EN" })).toBeInViewport({ ratio: 1 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "EN" })).toBeInViewport({ ratio: 1 });
  await page.goBack();
  // Nothing wider than the phone (else the browser zooms out and taps miss).
  const width = await page.evaluate(() => [
    window.innerWidth,
    document.documentElement.scrollWidth,
  ]);
  expect(width).toEqual([page.viewportSize()!.width, page.viewportSize()!.width]);

  await expect
    .poll(async () => {
      const [row] = await sql`
        SELECT count(*)::int AS n FROM analytics_events
        WHERE name = 'search_performed' AND properties->>'hasQuery' = 'true'`;
      return row!.n;
    })
    .toBeGreaterThan(0);

  // Filters work together and stay in the URL.
  await page.goto(`/restaurants?city=${encodeURIComponent(city)}`);
  await expect(results.getByRole("listitem")).toHaveCount(2);
  await page.getByLabel("Խոհանոց").selectOption("georgian");
  await page.getByRole("button", { name: "Որոնել" }).click();
  await expect(page).toHaveURL(/cuisine=georgian/);
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(results).toContainText(tbilisi);
  await page.getByLabel("Հիմա բաց է").check();
  await page.getByRole("button", { name: "Որոնել" }).click();
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(results.getByText("Բաց է")).toBeVisible();

  // Cuisine by its Armenian name finds the grill; Reserve goes to booking.
  await page.goto(
    `/restaurants?q=${encodeURIComponent("Հայկական")}&city=${encodeURIComponent(city)}`,
  );
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await results.getByRole("link", { name: `Ամրագրել ${zangak}-ում` }).click();
  await expect(page).toHaveURL(`/r/${grill}/center/reserve`);
});

/** §26: "Near me" sorts by distance (position asked only on tap), and the map shows pins. */
test("guests find the nearest restaurants and see them on a map", async ({ browser }) => {
  const tag = () => Math.random().toString(36).slice(2, 8);
  const city = `Երևան ${tag()}`;
  const far = `Կասկադ ${tag()}`;
  const near = `Հրապարակ ${tag()}`;
  await seed(far, { cuisines: "{armenian}", price: 2, city, at: [40.1913, 44.5152] });
  await seed(near, { cuisines: "{armenian}", price: 2, city, at: [40.1777, 44.5126] });

  const context = await browser.newContext({
    geolocation: { latitude: 40.178, longitude: 44.513 },
    permissions: ["geolocation"],
    locale: "hy-AM",
  });
  const page = await context.newPage();
  const cspViolations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) cspViolations.push(message.text());
  });
  await page.goto(`/restaurants?city=${encodeURIComponent(city)}`);
  await page.getByRole("button", { name: "Մոտակայքում" }).click();
  await expect(page).toHaveURL(
    /near=40\.178%2C44\.513.*sort=distance|sort=distance.*near=40\.178%2C44\.513/,
  );
  const results = page.getByRole("list", { name: "Գտնված ռեստորաններ" });
  await expect(results.getByRole("heading")).toHaveText([near, far]);
  await expect(results.getByRole("listitem").first()).toContainText(/0([.,]\d)? կմ/);

  await page.getByRole("link", { name: "Քարտեզ" }).click();
  const map = page.getByRole("region", { name: "Ռեստորանների քարտեզ" });
  await expect(map.locator("canvas")).toBeVisible();
  await expect(results.getByRole("listitem")).toHaveCount(2); // the list stays under the map
  await expectAccessible(page, "restaurant map");
  expect(cspViolations).toEqual([]);
  await context.close();
});
