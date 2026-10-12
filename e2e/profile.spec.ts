import { expect, test } from "./fixtures";

import { registerAndCreateRestaurant } from "./helpers";

test("owner edits the restaurant profile", async ({ page }) => {
  const id = await registerAndCreateRestaurant(page, "Պրոֆիլ Սրճարան");

  await page.getByRole("link", { name: "Պրոֆիլ" }).click();
  await expect(page).toHaveURL(`/dashboard/r/${id}/profile`);
  await expect(page.getByRole("link", { name: "Պրոֆիլ" })).toHaveAttribute("aria-current", "page");

  const save = page.getByRole("button", { name: "Պահպանել փոփոխությունները" });
  await expect(save).toBeDisabled(); // nothing changed yet

  await page.getByLabel("Նկարագրություն").fill("Լավագույն սուրճը Կասկադում");
  await page.getByRole("button", { name: "Սուրճ" }).click();
  await page.getByRole("button", { name: "Աղանդեր" }).click();
  await page.getByRole("radio", { name: "Միջին" }).click();

  // Invalid website is caught before saving
  await page.getByLabel("Կայք", { exact: true }).fill("not a url");
  await save.click();
  await expect(page.getByText("Արժեքը վավեր չէ։")).toBeVisible();

  await page.getByLabel("Կայք", { exact: true }).fill("https://cafe.am");
  await save.click();
  await expect(page.getByText("Պրոֆիլը պահպանված է։")).toBeVisible();
  await expect(save).toBeDisabled();

  // Persisted after reload
  await page.reload();
  await expect(page.getByLabel("Նկարագրություն")).toHaveValue("Լավագույն սուրճը Կասկադում");
  await expect(page.getByRole("button", { name: "Սուրճ" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Աղանդեր" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("radio", { name: "Միջին" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Կայք", { exact: true })).toHaveValue("https://cafe.am");

  // Overview tab still works
  await page.getByRole("link", { name: "Ընդհանուր" }).click();
  await expect(page).toHaveURL(`/dashboard/r/${id}`);
});
