import { test, expect } from "@playwright/test";

// the real page, driven like a player: the warden walks, birds come off the bus
// and follow, and the jail is still there after a reload
const state = (page) => page.evaluate(() => window.__jailbirds.state());

test("arrow keys walk the warden, and a drag walks the warden too", async ({ page }) => {
  await page.goto("/");
  const start = (await state(page)).warden;
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowLeft");
  const left = (await state(page)).warden;
  expect(left.x).toBeLessThan(start.x - 20);
  expect(Math.abs(left.y - start.y)).toBeLessThan(2);

  // a thumb stick: press anywhere in the jail and drag up
  const box = await page.locator("#jail").boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 60, { steps: 4 });
  await page.waitForTimeout(400);
  await page.mouse.up();
  const upward = (await state(page)).warden;
  expect(upward.y).toBeLessThan(left.y - 20);
  // let go and the warden stops
  await page.waitForTimeout(100);
  const stopped = (await state(page)).warden.y;
  await page.waitForTimeout(300);
  expect((await state(page)).warden.y).toBe(stopped);
});

test("birds from the bus follow the warden, and the jail survives a reload", async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => (await state(page)).birds.filter((b) => b.state === "wait").length, { timeout: 8000 }).toBe(3);
  await expect(page.locator("#tip")).toHaveText("walk to the birds at the bus stop");
  // the stop is down and to the left of the warden
  await page.keyboard.down("ArrowLeft");
  await page.keyboard.down("ArrowDown");
  await expect.poll(async () => (await state(page)).line.length, { timeout: 5000 }).toBeGreaterThan(0);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.up("ArrowDown");
  await expect(page.locator("#tip")).toHaveText("take them to the desk for striped shirts");
  const before = await state(page);
  // saved every couple of seconds and when the page goes away
  await page.waitForTimeout(2500);
  await page.reload();
  const after = await state(page);
  expect(after.birds.length).toBe(before.birds.length);
  expect(after.line.length).toBe(before.line.length);
  expect(after.steps).toBeGreaterThanOrEqual(before.steps);
});

test("start over asks first, then gives a fresh jail", async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => (await state(page)).birds.length, { timeout: 8000 }).toBe(3);
  await page.click("#restart");
  await page.click("#close");
  expect((await state(page)).birds.length).toBe(3);
  await page.click("#restart");
  await page.click("#confirm-restart");
  expect((await state(page)).birds.length).toBe(0);
  await expect(page.locator("#coins b")).toHaveText("0");
});
