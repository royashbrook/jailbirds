import { test, expect } from "./fixtures.js";
import { byId, inmates, line, me, queued, state, untilSim, waitSim, walkTo } from "./helpers.js";

// the real page, driven like a player: the warden walks, the bus brings
// inmates through the gate to the desk, standing behind the desk checks them in,
// walking up to them makes them follow, and a reload keeps it all. every wait is
// on the game's own state, with deadlines in game time, so a slow machine only
// makes it slower, never wrong.
const DESK = { x: 140, y: 584 }, DESK_R = 26;
const CORRIDOR = { x: 140, y: 540 };
const OUT = { x: 228, y: 680 };

test("arrow keys walk the warden, and a drag anywhere walks the warden too", async ({ page }) => {
  await page.goto("/");
  const start = await me(page);
  await page.keyboard.down("ArrowRight");
  await untilSim(page, (s) => s.agents[0].x > start.x + 20, 3, "the warden to walk right");
  await page.keyboard.up("ArrowRight");
  const right = await me(page);
  const turn = await page.evaluate(() => window.__jailbirds.camera().turn);
  expect(Math.abs(right.y - start.y + (right.x - start.x) * Math.tan(turn * Math.PI / 180))).toBeLessThan(2);
  expect(right.face).toBe(1);
  expect(right.walk).toBeGreaterThan(20);

  // a thumb stick: press anywhere in the jail and drag left
  const box = await page.locator("#jail").boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y, { steps: 3 });
  await untilSim(page, (s) => s.agents[0].x < right.x - 20, 3, "the warden to walk left");
  await page.mouse.up();
  const left = await me(page);
  expect(left.face).toBe(-1);
  // let go and the warden stops: a game second later it has not moved
  const stopped = (await waitSim(page, 0.2)).agents[0].x;
  expect((await waitSim(page, 1)).agents[0].x).toBe(stopped);
});

test("a tap shorter than a frame still moves the warden", async ({ page }) => {
  // every frame waits half a second, so a quick tap lands between two frames
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), 500);
  });
  await page.goto("/");
  await waitSim(page, 0.5);
  const start = await me(page);
  await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await untilSim(page, (s) => s.agents[0].x > start.x + 1, 2, "a tap to move the warden");
});

test("the bus, the desk, a line that fills up, and a reload that keeps it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#rank")).toHaveAttribute("aria-label", "level 1, 0 of 2 stars to the next");
  // the first bus: three walk through the gate and wait at the desk. these three,
  // by id, are the ones this test follows; a later bus is free to come and go
  const s0 = await untilSim(page, (s) => queued(s).length === 3, 20, "the first bus to queue up");
  const first = queued(s0).map((a) => a.id);
  // nobody is checked in while the warden is away from the desk
  const later = await waitSim(page, 2);
  expect(inmates(later).filter((b) => b.state === "ready")).toEqual([]);

  await walkTo(page, CORRIDOR);
  const at = await walkTo(page, DESK);
  expect(Math.hypot(at.x - DESK.x, at.y - DESK.y)).toBeLessThan(DESK_R);
  const s1 = await untilSim(page, (s) => first.every((id) => byId(s, id)?.state === "ready"), 5, "the first three checked in");
  expect(first.every((id) => byId(s1, id).tags.includes("uniform"))).toBe(true);
  expect(s1.piles.desk).toBeGreaterThanOrEqual(3 * 2);

  // walk up to them: two follow, from the first three, and the line is full
  await walkTo(page, OUT);
  const s2 = await untilSim(page, (s) => line(s).length === 2, 3, "two to follow");
  expect(line(s2).every((a) => first.includes(a.id))).toBe(true);
  await expect(page.locator("#line b")).toHaveText("2/2");
  await expect(page.locator("#line b")).toHaveClass(/full/);
  await expect(page.locator("#tip")).toHaveText("lead them to a cell with a free bed");

  // leaving the page saves it; the same two are following after a reload
  const before = await state(page);
  await page.reload();
  const after = await state(page);
  expect(line(after).map((a) => a.id).sort()).toEqual(line(before).map((a) => a.id).sort());
  expect(after.piles.desk).toBeGreaterThanOrEqual(before.piles.desk);
  expect(first.every((id) => byId(after, id)?.tags.includes("uniform"))).toBe(true);
});

test("start over asks first, then gives a fresh jail", async ({ page }) => {
  await page.goto("/");
  await untilSim(page, (s) => inmates(s).length === 3, 20, "the first bus");
  await page.click("#restart");
  await page.click("#close");
  // the sheet held the world still, and keep playing kept it
  expect(inmates(await state(page)).length).toBe(3);
  await page.click("#restart");
  await page.click("#confirm-restart");
  expect(inmates(await state(page)).length).toBe(0);
  await expect(page.locator("#coins b")).toHaveText("0");
  await expect(page.locator("#rank")).toHaveAttribute("aria-label", "level 1, 0 of 2 stars to the next");
});
