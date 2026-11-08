import { test, expect } from "@playwright/test";

// the real page, driven like a player: the warden walks, birds come off the bus
// and follow, the jail survives a reload, and start over asks first
const state = (page) => page.evaluate(() => window.__jailbirds.state());
const me = async (page) => (await state(page)).agents[0];
const inmates = (s) => s.agents.filter((a) => a.kind === "agent");
const line = (s) => s.agents.filter((a) => a.leader === s.agents[0].id && a.state === "follow");

test("arrow keys walk the warden, and a drag anywhere walks the warden too", async ({ page }) => {
  await page.goto("/");
  const start = await me(page);
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowLeft");
  const left = await me(page);
  expect(left.x).toBeLessThan(start.x - 20);
  expect(Math.abs(left.y - start.y)).toBeLessThan(2);
  expect(left.face).toBe(-1);
  expect(left.walk).toBeGreaterThan(20);

  // a thumb stick: press anywhere in the jail and drag right
  const box = await page.locator("#jail").boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 4 });
  await page.waitForTimeout(400);
  await page.mouse.up();
  const right = await me(page);
  expect(right.x).toBeGreaterThan(left.x + 20);
  expect(right.face).toBe(1);
  // let go and the warden stops
  await page.waitForTimeout(100);
  const stopped = (await me(page)).x;
  await page.waitForTimeout(300);
  expect((await me(page)).x).toBe(stopped);
});

test("birds from the bus follow the warden, and the jail survives a reload", async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => inmates(await state(page)).filter((b) => b.state === "wait").length, { timeout: 8000 }).toBe(3);
  await expect(page.locator("#tip")).toHaveText("walk to the birds at the bus stop");
  // the stop is down and to the left of the warden, round the intake
  await page.keyboard.down("ArrowLeft");
  await page.keyboard.down("ArrowDown");
  await expect.poll(async () => line(await state(page)).length, { timeout: 6000 }).toBeGreaterThan(0);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.up("ArrowDown");
  await expect(page.locator("#tip")).toHaveText("take them to the intake desk for striped shirts");
  const before = await state(page);
  // saved every couple of seconds and when the page goes away
  await page.waitForTimeout(2500);
  await page.reload();
  const after = await state(page);
  expect(inmates(after).length).toBe(inmates(before).length);
  expect(line(after).length).toBe(line(before).length);
  expect(after.steps).toBeGreaterThanOrEqual(before.steps);
});

test("start over asks first, then gives a fresh jail", async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => inmates(await state(page)).length, { timeout: 8000 }).toBe(3);
  await page.click("#restart");
  await page.click("#close");
  expect(inmates(await state(page)).length).toBe(3);
  await page.click("#restart");
  await page.click("#confirm-restart");
  expect(inmates(await state(page)).length).toBe(0);
  await expect(page.locator("#coins b")).toHaveText("0");
  await expect(page.locator("#stars")).toHaveAttribute("aria-label", "0 of 5 stars");
});
