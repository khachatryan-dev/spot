import { expect, test } from "./fixtures";

test("unknown pages get a translated 404 with a way home", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Էջը չի գտնվել" })).toBeVisible();
  await page.getByRole("link", { name: "Գլխավոր էջ" }).click();
  await expect(page).toHaveURL("/");

  const english = await page.goto("/en/no-such-page");
  expect(english?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
