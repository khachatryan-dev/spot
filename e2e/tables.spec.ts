import { expect, sql, test } from "./fixtures";
import { registerAndCreateRestaurant } from "./helpers";

test("owner sets up and manages tables", async ({ page }) => {
  const id = await registerAndCreateRestaurant(page, "Սեղան Ռեստորան");
  await page.getByLabel("Մասնաճյուղի անվանումը").fill("Կենտրոն");
  await page.getByLabel("Հասցե").fill("Աբովյան 1");
  await page.getByRole("button", { name: "Ավելացնել մասնաճյուղ" }).click();
  await expect(page.getByText("Աբովյան 1, Երևան")).toBeVisible();

  await page.getByRole("link", { name: "Սեղաններ", exact: true }).click();
  await expect(page).toHaveURL(`/dashboard/r/${id}/tables`);

  // Tables 1–5 at once
  await page.getByLabel("Մինչև").fill("5");
  await page.getByRole("button", { name: "Ավելացնել 1–5 սեղանները" }).click();
  const list = page.getByRole("list", { name: "Սեղաններ" });
  await expect(list.getByRole("listitem")).toHaveCount(5);

  // A duplicate number is refused
  await page.getByLabel("Համար", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Ավելացնել սեղան" }).click();
  await expect(page.getByText("Այս համարով սեղան արդեն կա։")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(5);

  // A VIP table on the terrace
  await page.getByLabel("Համար", { exact: true }).fill("VIP");
  await page.getByLabel("Տեղեր").first().fill("10");
  await page.getByLabel("Գոտի").fill("Պատշգամբ");
  await page.getByRole("button", { name: "Ավելացնել սեղան" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(6);
  await expect(list.getByRole("listitem").last()).toContainText("10 տեղ · Պատշգամբ");

  // Status change
  await page.getByLabel("2 սեղանի կարգավիճակը").selectOption("reserved");
  await expect(page.getByLabel("2 սեղանի կարգավիճակը")).toHaveValue("reserved");

  // Edit table 5: private room, not in use
  await page.getByRole("button", { name: "Խմբագրել 5 սեղանը" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Տեսակ").selectOption("private");
  await dialog.getByRole("checkbox", { name: "Սեղանն օգտագործվում է" }).uncheck();
  await dialog.getByRole("button", { name: "Պահպանել" }).click();
  await expect(page.getByText("Սեղանը պահպանված է։")).toBeVisible();
  await expect(list.getByRole("listitem").nth(4)).toContainText("Առանձնասենյակ");
  await expect(list.getByRole("listitem").nth(4)).toContainText("Ոչ ակտիվ");

  // Move VIP to the top
  for (let position = 4; position >= 0; position--) {
    await page.getByRole("button", { name: "Տեղափոխել VIP սեղանը վերև" }).click();
    await expect(list.getByRole("listitem").nth(position)).toContainText("VIP");
  }

  // Persisted
  await page.reload();
  await expect(list.getByRole("listitem").first()).toContainText("VIP");
  const rows =
    await sql`SELECT number, status, type, is_active FROM tables WHERE restaurant_id = ${id} ORDER BY sort_order`;
  expect(rows.map((r) => r.number)).toEqual(["VIP", "1", "2", "3", "4", "5"]);
  expect(rows.find((r) => r.number === "2")?.status).toBe("reserved");
  expect(rows.find((r) => r.number === "5")).toMatchObject({ type: "private", is_active: false });
});
