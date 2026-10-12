import { expect, test } from "./fixtures";

/** §30: secure headers on every response, a working CSP nonce, cross-site writes refused. */
test("pages and APIs send the security headers; the CSP nonce reaches Next's scripts", async ({
  page,
  request,
}) => {
  const response = (await page.goto("/"))!;
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers["x-powered-by"]).toBeUndefined();

  const csp = headers["content-security-policy"]!;
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  expect(csp).toContain("frame-ancestors 'none'");
  // Every script Next rendered carries this request's nonce…
  const scriptNonces = await page
    .locator("script")
    .evaluateAll((els) => els.map((el) => (el as HTMLScriptElement).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(new Set(scriptNonces)).toEqual(new Set([nonce]));
  // …and a fresh request gets a fresh nonce.
  const again = (await page.reload())!.headers()["content-security-policy"];
  expect(again).not.toBe(csp);

  // Client code still runs under the policy: the language switcher works.
  await page.getByRole("button", { name: "EN" }).click();
  await expect(page).toHaveURL("/en");

  // APIs get the static headers too
  const health = await request.get("/api/health");
  expect(health.headers()["x-content-type-options"]).toBe("nosniff");

  // A cross-site POST to a cookie-authenticated route is refused
  const crossSite = await request.post("/api/realtime/token", {
    headers: { origin: "https://evil.example" },
    data: { channel: "session:x" },
  });
  expect(crossSite.status()).toBe(403);
});
