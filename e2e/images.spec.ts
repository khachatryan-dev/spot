import sharp from "sharp";

import { expect, test } from "./fixtures";
import { registerAndCreateRestaurant } from "./helpers";

test("owner uploads, replaces and removes the restaurant logo", async ({ page }) => {
  const id = await registerAndCreateRestaurant(page, "Նկար Սրճարան");
  await page.goto(`/dashboard/r/${id}/profile`);

  const logo = (color: string) =>
    sharp({ create: { width: 300, height: 300, channels: 3, background: color } })
      .png()
      .toBuffer();

  // Upload
  await page
    .locator("#upload-logo")
    .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: await logo("#c84") });
  const img = page.getByRole("img", { name: "Լոգո" });
  await expect(img).toBeVisible();
  const firstSrc = await img.getAttribute("src");
  expect(firstSrc).toMatch(/\/spot-uploads-test\/restaurants\/.+\/logo\/.+\.webp$/);
  expect((await page.request.get(firstSrc!)).status()).toBe(200);

  // Replace: new URL, old file gone
  await page
    .locator("#upload-logo")
    .setInputFiles({ name: "logo2.png", mimeType: "image/png", buffer: await logo("#48c") });
  await expect(img).not.toHaveAttribute("src", firstSrc!);
  expect((await page.request.get(firstSrc!)).status()).toBe(404);

  // A file pretending to be an image is refused
  await page.locator("#upload-logo").setInputFiles({
    name: "evil.png",
    mimeType: "image/png",
    buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
  });
  await expect(
    page.getByText("Օգտագործեք համապատասխան չափի JPEG, PNG կամ WebP նկար։"),
  ).toBeVisible();

  // Remove
  await page.getByRole("button", { name: "Հեռացնել Լոգո" }).click();
  await expect(page.getByRole("img", { name: "Լոգո" })).toHaveCount(0);
});
