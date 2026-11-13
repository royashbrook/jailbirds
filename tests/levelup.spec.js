import { test, expect } from "./fixtures.js";
import { queued, state, untilSim, waitFrames, walkTo } from "./helpers.js";

// a level up opens a little window of its own: the new level, the money it paid, and a big ok.
// the jail holds still behind it the way it does for every sheet, and ok lets it go on
const STAMP = { x: 600, y: 704 };
const steps = (page) => state(page).then((s) => s.steps);
const heard = (page) => page.evaluate(() => window.__jailbirds.sound());

/** the first bus queued, one of them following the warden with all they need, `stars` short
 * of nothing, and the jail opened again from that save with the warden `off` to the left of
 * the release desk (0 is on it, and they are set free at once) */
async function oneToFree(page, stars, off = 0) {
  await page.goto("/");
  const world = await untilSim(page, (s) => queued(s).length === 3, 20, "the first bus to queue up");
  const [done, ...rest] = world.agents.slice(1);
  const at = { x: STAMP.x - off, y: STAMP.y };
  const led = { ...done, state: "follow", leader: world.agents[0].id, house: "c0", slot: 0, served: 999, x: at.x, y: at.y - 16, path: [] };
  const save = { ...world, coins: 0, stars, agents: [{ ...world.agents[0], ...at }, led, ...rest] };
  await page.addInitScript((raw) => {
    // an old save, on a device with no map yet: it is moved over as the page opens
    localStorage.removeItem("jailbirds:map");
    localStorage.setItem("jailbirds:save", raw);
  }, JSON.stringify(save));
  await page.reload();
  return world;
}

test("the star that levels her up opens a level up window, the jail holds still, ok lets it go on", async ({ page }) => {
  const world = await oneToFree(page, 1, 60);
  // a key that walks nobody wakes the sound, then walk to the desk
  await page.keyboard.press("Shift");
  await expect.poll(() => heard(page).then((s) => s.state)).toBe("running");
  expect((await state(page)).released).toBe(0);
  // walk over until she is set free: the window may hold the jail still before he gets all the way
  await walkTo(page, STAMP, 6, (s) => s.released === 1);

  const popup = page.locator("#level-up");
  await expect(popup).toBeVisible();
  const after = await state(page);
  expect(after.released).toBe(1);
  expect(after.rank).toBe(world.rank + 1);
  // the money it shows is what the sim paid: she had none before
  expect(after.coins).toBeGreaterThan(0);
  await expect(popup.locator("h2")).toHaveText(`level ${after.rank}!`);
  await expect(popup.locator(".level-reward")).toHaveText(`+$${after.coins}`);
  await expect(page.locator("#level-ok")).toBeVisible();
  // the level up sound played, once
  await expect.poll(() => heard(page).then((s) => s.cues.rank)).toBe(1);

  // held still while it is up: frames go by, the steps do not
  const held = await steps(page);
  await waitFrames(page, 30);
  expect(await steps(page)).toBe(held);
  await expect(popup).toBeVisible();

  await page.locator("#level-ok").click();
  await expect(popup).toHaveCount(0);
  await expect(page.locator("dialog")).toHaveCount(0);
  await untilSim(page, (s) => s.steps > held + 30, 2, "the jail to go on");
  // and ok did not sound the level up again
  expect((await heard(page)).cues.rank).toBe(1);
});

test("with less motion the level up window still shows, with nothing flying about", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await oneToFree(page, 1);
  const popup = page.locator("#level-up");
  await expect(popup).toBeVisible();
  const moving = await popup.locator(".confetti i, .level-stars svg").evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
  expect(moving.length).toBeGreaterThan(0);
  expect(new Set(moving)).toEqual(new Set(["none"]));
  await page.locator("#level-ok").click();
  await expect(popup).toHaveCount(0);
});

test("a star that does not fill the level opens no window", async ({ page }) => {
  await oneToFree(page, 0);
  await untilSim(page, (s) => s.released === 1, 3, "the release");
  await waitFrames(page, 10);
  await expect(page.locator("#level-up")).toHaveCount(0);
  const s = await state(page);
  await untilSim(page, (n) => n.steps > s.steps + 30, 2, "the jail to go on");
});
