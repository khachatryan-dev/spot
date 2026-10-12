import { expect, test } from "./fixtures";

import { registerAndCreateRestaurant } from "./helpers";

test("owner edits a location's hours, coordinates and settings", async ({ page }) => {
  const id = await registerAndCreateRestaurant(page, "Ժամեր Ռեստորան");

  // Add a location from the Locations tab
  await page.getByRole("link", { name: "Մասնաճյուղեր", exact: true }).click();
  await expect(page).toHaveURL(`/dashboard/r/${id}/locations`);
  await page.getByLabel("Մասնաճյուղի անվանումը").fill("Արաբկիր");
  await page.getByLabel("Հասցե").fill("Կոմիտաս 5");
  await page.getByRole("button", { name: "Ավելացնել մասնաճյուղ" }).click();
  await page.getByRole("link", { name: /Արաբկիր/ }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/r/${id}/locations/[0-9a-f-]{36}$`));
  await expect(page.getByRole("link", { name: "Մասնաճյուղեր", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Monday 10:00–23:00, copied to the whole week
  await page.getByRole("checkbox", { name: "Երկուշաբթի" }).check();
  await page.getByLabel("Երկուշաբթի՝ բացվում է").fill("10:00");
  await page.getByLabel("Երկուշաբթի՝ փակվում է").fill("23:00");
  await page.getByRole("button", { name: "Կրկնել երկուշաբթին բոլոր օրերի համար" }).click();
  await expect(page.getByLabel("Կիրակի՝ բացվում է")).toHaveValue("10:00");

  // Coordinates must come in pairs
  await page.getByLabel("Լայնություն").fill("40.2");
  const save = page.getByRole("button", { name: "Պահպանել մասնաճյուղը" });
  await save.click();
  await expect(
    page.getByText("Մուտքագրեք և՛ լայնությունը, և՛ երկայնությունը, կամ ոչ մեկը։"),
  ).toBeVisible();
  await page.getByLabel("Երկայնություն").fill("44.49");

  await page.getByRole("checkbox", { name: "Ընդունել սեղանի ամրագրումներ" }).check();
  await save.click();
  await expect(page.getByText("Մասնաճյուղը պահպանված է։")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Ուրբաթ՝ փակվում է")).toHaveValue("23:00");
  await expect(page.getByLabel("Լայնություն")).toHaveValue("40.2");
  await expect(page.getByLabel("Երկայնություն")).toHaveValue("44.49");
  await expect(page.getByRole("checkbox", { name: "Ընդունել սեղանի ամրագրումներ" })).toBeChecked();
});
