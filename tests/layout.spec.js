import { test, expect } from "@playwright/test";

// the house layout on every screen we design for: phones and an ipad either way
// up. logo up top on the left, version top right, the jail filling the middle,
// the buttons along the bottom, nothing scrolls.
const SIZES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1024, height: 1366 },
  { width: 1366, height: 1024 },
];
for (const size of SIZES)
  test(`${size.width}x${size.height}: logo and version up top, jail filling the middle, buttons along the bottom`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    const b = (s) => page.locator(s).boundingBox();
    const jail = await b("#jail"), logo = await b(".hud .logo"), ver = await b(".hud .corner"), nav = await b(".nav");
    expect(logo.y + logo.height).toBeLessThanOrEqual(jail.y);
    expect(logo.x).toBeLessThan(size.width * 0.2);
    expect(ver.y).toBeLessThan(logo.y + logo.height);
    expect(ver.x + ver.width).toBeGreaterThan(size.width * 0.85);
    expect(nav.y).toBeGreaterThanOrEqual(jail.y + jail.height);
    // the jail fills the screen: most of the height, nearly all of the width
    expect(jail.height).toBeGreaterThan(size.height * 0.55);
    expect(jail.width).toBeGreaterThan(size.width * 0.9);
    // the canvas draws at the real density, capped at 2 for the gpu
    const px = await page.evaluate(() => { const c = document.querySelector("#jail"); return { w: c.width, css: c.getBoundingClientRect().width, dpr: devicePixelRatio }; });
    expect(Math.abs(px.w - px.css * Math.min(2, px.dpr))).toBeLessThanOrEqual(1);
    const fit = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
    expect(fit.w).toBeLessThanOrEqual(size.width);
    expect(fit.h).toBeLessThanOrEqual(size.height);
    // the house checker finds about by name: the menu button says it opens about too
    await expect(page.getByRole("button", { name: /about/i }).first()).toBeVisible();
    for (const id of ["#about", "#restart"]) {
      const box = await b(id);
      expect(Math.min(box.width, box.height), id).toBeGreaterThanOrEqual(44);
    }
  });

test("turning an ipad round refits the jail to the new shape", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto("/");
  const tall = await page.locator("#jail").boundingBox();
  await page.setViewportSize({ width: 1366, height: 1024 });
  await expect.poll(async () => (await page.locator("#jail").boundingBox()).width).toBeGreaterThan(tall.width + 200);
  // the backing store catches up a frame or so after the css box: wait for both sides
  await expect.poll(() => page.evaluate(() => {
    const c = document.querySelector("#jail"), r = c.getBoundingClientRect(), d = Math.min(2, devicePixelRatio);
    // three floors the backing store, so a hair under d rounds to -0: add 0 to make it plain 0
    return [c.width / r.width, c.height / r.height].map((x) => Math.round((x - d) * 10) + 0);
  })).toEqual([0, 0]);
});

// light unless the phone asks for dark
test("a phone with no colour setting gets light, a dark phone gets dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "no-preference" });
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 248, 236)");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(27, 26, 34)");
});
