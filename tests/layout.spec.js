import { test, expect } from "@playwright/test";

// the house layout: logo up top on the left, the version in the top right
// corner, the jail, then the buttons along the bottom, like the other games
for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }])
  test(`${size.width}x${size.height}: logo and version up top, jail in the middle, buttons along the bottom`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    const b = (s) => page.locator(s).boundingBox();
    const jail = await b("#jail"), logo = await b(".hud .logo"), ver = await b(".hud .corner"), nav = await b(".nav");
    expect(logo.y + logo.height).toBeLessThanOrEqual(jail.y);
    expect(logo.x).toBeLessThan(size.width * 0.2);
    expect(ver.y + ver.height).toBeLessThanOrEqual(logo.y + logo.height);
    expect(ver.x + ver.width).toBeGreaterThan(size.width * 0.85);
    expect(nav.y).toBeGreaterThanOrEqual(jail.y + jail.height);
    // the play area is real room, not a sliver
    expect(jail.height).toBeGreaterThan(size.height * 0.4);
    // no scroll either way
    const fit = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
    expect(fit.w).toBeLessThanOrEqual(size.width);
    expect(fit.h).toBeLessThanOrEqual(size.height);
    // the house checker finds about by name: the menu button says it opens about too
    await expect(page.getByRole("button", { name: /about/i }).first()).toBeVisible();
  });

// light unless the phone asks for dark
test("a phone with no colour setting gets light, a dark phone gets dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "no-preference" });
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 248, 236)");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(27, 26, 34)");
});
