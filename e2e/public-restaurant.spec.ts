import { expect, sql, test } from "./fixtures";
import { expectAccessible, seedBookableRestaurant } from "./helpers";

/** §26/§39: an approved restaurant's public page — content, metadata and structured data. */
test("public restaurant page with menu, hours, metadata and schema.org data", async ({ page }) => {
  const { slug, restaurantId } = await seedBookableRestaurant();
  await sql`
    UPDATE restaurants SET description = 'Խորոված և տոլմա Աբովյանի վրա',
      cuisines = '{armenian,grill}', price_range = 2, phone = '+37410555555'
    WHERE id = ${restaurantId}`;
  const [location] =
    await sql`SELECT id FROM restaurant_locations WHERE restaurant_id = ${restaurantId}`;
  const [menu] =
    await sql`INSERT INTO menus (restaurant_id, name) VALUES (${restaurantId}, 'Հիմնական') RETURNING id`;
  await sql`INSERT INTO menu_locations (menu_id, location_id, restaurant_id) VALUES (${menu!.id}, ${location!.id}, ${restaurantId})`;
  const [category] = await sql`
    INSERT INTO menu_categories (restaurant_id, menu_id, name) VALUES (${restaurantId}, ${menu!.id}, 'Խորոված') RETURNING id`;
  await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, description, price_minor)
    VALUES (${restaurantId}, ${category!.id}, 'Խոզի խորոված', 'Փայտի կրակի վրա', 450000)`;

  const cspViolations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) cspViolations.push(message.text());
  });
  const response = (await page.goto(`/r/${slug}`))!;
  expect(response.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Արարատ" })).toBeVisible();
  await expect(page.getByText("Խորոված և տոլմա Աբովյանի վրա")).toBeVisible();
  await expect(page.getByText("Հայկական")).toBeVisible();
  const menuSection = page.getByRole("region", { name: "Մենյու" });
  await expect(menuSection).toContainText("Խոզի խորոված");
  await expect(menuSection).toContainText(/4.500.֏/);
  await page.getByText("Աշխատանքային ժամեր").click();
  await expect(page.getByText("10:00–22:00").first()).toBeVisible();
  await expectAccessible(page, "public restaurant page");

  // Search engines: title, canonical and language links, share preview, schema.org.
  await expect(page).toHaveTitle("Արարատ — ռեստորան Երևանում");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    new RegExp(`/r/${slug}$`),
  );
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
    "href",
    new RegExp(`/en/r/${slug}$`),
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Արարատ");
  const jsonLd = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent())!,
  );
  expect(jsonLd).toEqual([
    expect.objectContaining({
      "@type": "Restaurant",
      name: "Արարատ",
      priceRange: "֏֏",
      telephone: "+37410555555",
      address: expect.objectContaining({ streetAddress: "Աբովյան 1", addressLocality: "Երևան" }),
      acceptsReservations: expect.stringContaining(`/r/${slug}/center/reserve`),
    }),
  ]);
  expect(jsonLd[0].openingHoursSpecification).toHaveLength(7);
  expect(cspViolations).toEqual([]);

  // The visit is counted (after the response, without personal data).
  await expect
    .poll(async () => {
      const rows = await sql`
        SELECT visitor_key FROM analytics_events
        WHERE name = 'restaurant_viewed' AND restaurant_id = ${restaurantId}`;
      return rows.length;
    })
    .toBeGreaterThan(0);

  // Reserve leads to the booking page; English works too.
  await page.getByRole("link", { name: "Ամրագրել սեղան" }).click();
  await expect(page).toHaveURL(`/r/${slug}/center/reserve`);
  await page.goto(`/en/r/${slug}`);
  await expect(page.getByRole("link", { name: "Reserve a table" })).toBeVisible();

  // Not public → not found.
  await sql`UPDATE restaurants SET status = 'suspended' WHERE id = ${restaurantId}`;
  expect((await page.goto(`/r/${slug}`))!.status()).toBe(404);
});

/** §39: search engines get a sitemap of public pages and stay out of private ones. */
test("sitemap lists approved restaurants in both languages; robots keeps crawlers out of private areas", async ({
  request,
}) => {
  const { slug } = await seedBookableRestaurant();
  const { slug: hidden, restaurantId: hiddenId } = await seedBookableRestaurant();
  await sql`UPDATE restaurants SET status = 'draft' WHERE id = ${hiddenId}`;

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()["content-type"]).toContain("xml");
  const xml = await sitemap.text();
  expect(xml).toContain(`/r/${slug}</loc>`);
  expect(xml).toContain(`/en/r/${slug}</loc>`);
  expect(xml).toMatch(new RegExp(`hreflang="en" href="[^"]*/en/r/${slug}"`));
  expect(xml).toContain("/restaurants</loc>");
  expect(xml).not.toContain(`/r/${hidden}`);

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /");
  expect(robots).toContain("Disallow: /dashboard");
  expect(robots).toContain("Disallow: /en/account");
  expect(robots).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
});
