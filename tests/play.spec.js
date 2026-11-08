import { test, expect } from "@playwright/test";

// the real page, driven like a player with the arrow keys: the warden walks,
// the bus brings birds through the gate to the desk, standing behind the desk
// checks them in, walking up to them makes them follow, a reload keeps it all
const state = (page) => page.evaluate(() => window.__jailbirds.state());
const me = async (page) => (await state(page)).agents[0];
const inmates = (s) => s.agents.filter((a) => a.kind === "agent");
const line = (s) => s.agents.filter((a) => a.leader === s.agents[0].id && a.state === "follow");

/** hold the arrow keys toward a point, across then down, watching where the warden is */
async function walkTo(page, to) {
  for (const axis of ["x", "y"])
    for (let i = 0; i < 80; i++) {
      const d = to[axis] - (await me(page))[axis];
      if (Math.abs(d) < 5) break;
      const key = axis === "x" ? (d < 0 ? "ArrowLeft" : "ArrowRight") : d < 0 ? "ArrowUp" : "ArrowDown";
      await page.keyboard.down(key);
      await page.waitForTimeout(Math.max(30, Math.min(250, (Math.abs(d) / 95) * 1000 - 20)));
      await page.keyboard.up(key);
    }
}

test("arrow keys walk the warden, and a drag anywhere walks the warden too", async ({ page }) => {
  await page.goto("/");
  const start = await me(page);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowRight");
  const right = await me(page);
  expect(right.x).toBeGreaterThan(start.x + 20);
  expect(Math.abs(right.y - start.y)).toBeLessThan(2);
  expect(right.face).toBe(1);
  expect(right.walk).toBeGreaterThan(20);

  // a thumb stick: press anywhere in the jail and drag left
  const box = await page.locator("#jail").boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y, { steps: 4 });
  await page.waitForTimeout(400);
  await page.mouse.up();
  const left = await me(page);
  expect(left.x).toBeLessThan(right.x - 20);
  expect(left.face).toBe(-1);
  // let go and the warden stops
  await page.waitForTimeout(100);
  const stopped = (await me(page)).x;
  await page.waitForTimeout(300);
  expect((await me(page)).x).toBe(stopped);
});

test("the bus, the desk, a line that fills up, and a reload that keeps it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#rank")).toHaveAttribute("aria-label", "level 1, 0 of 2 stars to the next");
  await expect.poll(async () => inmates(await state(page)).filter((b) => b.state === "queue").length, { timeout: 12000 }).toBe(3);
  await expect(page.locator("#tip")).toHaveText("stand behind the intake desk to check them in");
  // nobody gets checked in until the warden is behind the desk
  await page.waitForTimeout(800);
  expect(inmates(await state(page)).filter((b) => b.state === "ready").length).toBe(0);
  await walkTo(page, { x: 140, y: 584 });
  await expect.poll(async () => inmates(await state(page)).filter((b) => b.state === "ready").length, { timeout: 6000 }).toBe(3);
  expect(inmates(await state(page)).every((b) => b.tags.includes("uniform"))).toBe(true);
  await expect(page.locator("#tip")).toHaveText("walk up to the checked-in birds to lead them");
  // walk up to them: two follow and the line is full
  await walkTo(page, { x: 228, y: 680 });
  await expect.poll(async () => line(await state(page)).length).toBe(2);
  await expect(page.locator("#line b")).toHaveText("2/2");
  await expect(page.locator("#line b")).toHaveClass(/full/);
  await expect(page.locator("#tip")).toHaveText("lead them to a cell with a free bed");
  const before = await state(page);
  // saved every couple of seconds and when the page goes away
  await page.waitForTimeout(2500);
  await page.reload();
  const after = await state(page);
  expect(line(after).length).toBe(2);
  expect(inmates(after).length).toBe(inmates(before).length);
  expect(after.piles.desk).toBe(before.piles.desk);
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
  await expect(page.locator("#rank")).toHaveAttribute("aria-label", "level 1, 0 of 2 stars to the next");
});
