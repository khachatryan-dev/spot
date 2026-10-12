import { expect, test } from "./fixtures";
import { expectAccessible, seedBookableRestaurant, tomorrowInYerevan } from "./helpers";

/** §25: a guest's account — profile, saved restaurants, phone pre-filled when booking. */
test("a guest sets up their account, saves a restaurant and books with their phone", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { slug } = await seedBookableRestaurant();

  await page.goto("/register?next=%2Faccount");
  await page.getByLabel("Անուն").fill("Նարե");
  await page.getByLabel("Էլ. փոստ").fill(`nare-${Date.now()}@example.am`);
  await page.getByLabel("Գաղտնաբառ").fill("correct horse battery");
  await page.getByRole("button", { name: "Ստեղծել հաշիվ" }).click();
  await expect(page).toHaveURL("/account");
  await expect(page.getByLabel("Անուն")).toHaveValue("Նարե");

  await page.getByLabel("Հեռախոս").fill("+374 91 55-66-77");
  await page.getByRole("button", { name: "Պահպանել" }).click();
  await expect(page.getByText("Պրոֆիլը պահպանված է։")).toBeVisible();
  await expect(page.getByText("Սեղմեք սրտիկը ռեստորանի էջում")).toBeVisible();
  await expectAccessible(page, "my account");

  // Save the restaurant from its page.
  const reservePath = `/r/${slug}/center/reserve?date=${tomorrowInYerevan()}&party=2`;
  await page.goto(reservePath);
  const heart = page.getByRole("button", { name: "Պահպանել Արարատ-ը" });
  await heart.click();
  await expect(
    page.getByRole("button", { name: "Հեռացնել Արարատ-ը պահպանվածներից" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Booking pre-fills the phone from the profile.
  await page.getByRole("button", { name: "Ընտրել 12:00" }).click();
  await expect(page.getByLabel("Հեռախոս")).toHaveValue("+37491556677");
  // Give the held table back.
  await page.getByRole("button", { name: "Ընտրել այլ ժամ" }).click();
  await expect(page.getByRole("button", { name: "Ընտրել 12:00" })).toBeVisible();

  await page.goto("/account");
  const saved = page.getByRole("region", { name: "Պահպանված ռեստորաններ" });
  await expect(saved).toContainText("Արարատ");
  await saved.getByRole("link", { name: "Ամրագրել" }).click();
  await expect(page).toHaveURL(`/r/${slug}/center/reserve`);

  // The site header now links to the account.
  await page.goto("/");
  await page.getByRole("link", { name: "Իմ հաշիվը" }).click();
  await expect(page).toHaveURL("/account");
});
