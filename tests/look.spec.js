import { test, expect } from "./fixtures.js";
import { untilSim, waitFrames } from "./helpers.js";

// the 3d look: peg people by default, drawn with webgl in a handful of draw
// calls, a camera that follows the warden, and html signs laid over the world
const drawn = (page) => page.evaluate(() => window.__jailbirds.drawn());

test("the default characters are peg people, drawn in 3d", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(() => window.__jailbirds.skin())).toBe("pegs");
  await waitFrames(page, 6);
  const d = await drawn(page);
  expect(d.webgl).toBe(true);
  expect(d.triangles).toBeGreaterThan(1000);
  // instancing keeps the whole jail to a few dozen draw calls
  expect(d.calls).toBeLessThan(80);
  await expect(page.locator(".nogl")).toHaveCount(0);
  // no look picker: one skin, no settings button
  await expect(page.locator("#nav-settings")).toHaveCount(0);
  await page.click("#about");
  await expect(page.locator(".card")).toContainText("new inmates come by bus");
  await expect(page.locator(".card")).toContainText("orange shirts");
});

test("an ipad shows price tags over visible pads and labels level locks", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto("/");
  await waitFrames(page, 3);
  expect(await page.locator(".tag:not([hidden])").count()).toBeGreaterThan(3);
  await expect(page.locator(".tag:not([hidden])", { hasText: "cell" }).first()).toBeVisible();
  // a tag waiting on a level says so
  await expect(page.locator(".tag.locked:not([hidden])").first()).toContainText(/lv \d/);
});

test("the camera follows the warden and a drag shows the thumb stick", async ({ page }) => {
  await page.goto("/");
  await waitFrames(page, 6);
  const box = await page.locator("#jail").boundingBox();
  const start = await page.evaluate(() => window.__jailbirds.warden());
  expect(Math.abs(start.x - box.width / 2)).toBeLessThan(box.width * 0.3);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 50, y, { steps: 3 });
  await waitFrames(page, 2);
  await expect(page.locator(".stick")).toBeVisible();
  await untilSim(page, (s) => s.agents[0].x > 330 + 100, 4, "the warden to walk right");
  await page.mouse.up();
  await waitFrames(page, 2);
  await expect(page.locator(".stick")).toBeHidden();
  // it walked right, and the view came along: once the camera has eased in,
  // the warden is near the middle again
  await waitFrames(page, 20);
  const after = await page.evaluate(() => window.__jailbirds.warden());
  expect(Math.abs(after.x - box.width / 2)).toBeLessThan(box.width * 0.12);
});
