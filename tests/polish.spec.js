import { test, expect } from "./fixtures.js";
import { queued, state, untilSim, walkTo } from "./helpers.js";

// the little things that say "you got it": a "+7" off the warden, a count that jumps,
// a ring where a pad was bought. when each shows and for how long is tests/overlay.test.mjs;
// this is the page: what the game hands them, where they sit, and less motion.
// a "+7" is up for under a second, so the page itself writes down each one as it
// shows and as it goes, and the test reads that, never racing the clock.
function watch() {
  const log = (window.__pops = []);
  new MutationObserver((list) => {
    for (const { target: el } of list) {
      if (!el.classList.contains("pop") && !el.classList.contains("ring")) continue;
      const box = el.getBoundingClientRect(), root = el.parentElement.getBoundingClientRect(), style = getComputedStyle(el);
      log.push({
        what: el.classList.contains("ring") ? "ring" : el.classList.contains("star") ? "star" : "coin",
        shown: !el.hidden, text: el.textContent, at: performance.now(),
        x: box.x + box.width / 2 - root.x, y: box.y + box.height / 2 - root.y,
        display: style.display, motion: style.animationName, quiet: el.getAttribute("aria-hidden"),
        warden: window.__jailbirds.warden(),
      });
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
}
const log = (page) => page.evaluate(() => window.__pops);
const tally = (page) => page.evaluate(() => window.__jailbirds.pops());
const motion = (locator) => locator.evaluate((el) => getComputedStyle(el).animationName);
const PILE = { x: 50, y: 700 }, STAMP = { x: 600, y: 704 }, CELL3 = { x: 235, y: 184 };

/** the jail as it stands, saved with a few things changed, and opened again */
async function reopen(page, world, change) {
  const warden = { ...world.agents[0], ...change.warden };
  const save = { ...world, ...change, agents: [warden, ...(change.others ?? world.agents.slice(1))] };
  delete save.warden;
  delete save.others;
  await page.addInitScript((raw) => localStorage.setItem("jailbirds:save", raw), JSON.stringify(save));
  await page.reload();
}
const started = (page) => untilSim(page, (s) => s.steps > 5, 1, "the game to start");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(watch);
});

test("coins picked up float a +7 off the warden and the count jumps", async ({ page }) => {
  await page.goto("/");
  await reopen(page, await started(page), { coins: 0, piles: { desk: 7 }, warden: { x: 115, y: 700 } });
  await started(page);
  expect(await tally(page)).toEqual({ coins: 0, stars: 0, rings: 0 });
  expect(await log(page)).toEqual([]);
  await expect(page.locator("#coins b")).toHaveText("0");
  await expect(page.locator("#coins b")).not.toHaveClass(/jump/);

  await walkTo(page, PILE, 12);
  await untilSim(page, (s) => s.coins === 7, 2, "the pile to be picked up");
  await expect.poll(() => tally(page)).toEqual({ coins: 7, stars: 0, rings: 0 });
  await expect(page.locator("#coins b")).toHaveText("7");
  await expect(page.locator("#coins b")).toHaveClass(/jump/);
  expect(await motion(page.locator("#coins b"))).toBe("jump");
  await expect(page.locator("#rank .badge")).not.toHaveClass(/jump/);

  // one "+7", with a coin and not a star, over the warden, and gone in its time
  await expect.poll(() => log(page).then((l) => l.length)).toBe(2);
  const [up, down] = await log(page);
  expect(up).toMatchObject({ what: "coin", shown: true, text: "+7", display: "flex", motion: "pop", quiet: "true" });
  expect(Math.abs(up.x - up.warden.x)).toBeLessThan(3);
  expect(up.y).toBeLessThan(up.warden.y);
  expect(up.y).toBeGreaterThan(up.warden.y - 120);
  expect(down).toMatchObject({ what: "coin", shown: false, text: "+7" });
  expect(down.at - up.at).toBeGreaterThan(850);
});

test("a release floats a +1 star and the star badge jumps, not the coins", async ({ page }) => {
  await page.goto("/");
  const world = await untilSim(page, (s) => queued(s).length === 3, 20, "the first bus to queue up");
  // one of them has had all they need and is led to the stamp
  const [done, ...rest] = world.agents.slice(1);
  const led = { ...done, state: "follow", leader: world.agents[0].id, house: "c0", slot: 0, served: 999, x: STAMP.x, y: STAMP.y - 16, path: [] };
  await reopen(page, world, { coins: 0, warden: STAMP, others: [led, ...rest] });
  await untilSim(page, (s) => s.released === 1, 3, "the release");
  await expect.poll(() => tally(page)).toEqual({ coins: 0, stars: 1, rings: 0 });
  await expect(page.locator("#rank")).toHaveAttribute("aria-label", "level 1, 1 of 2 stars to the next");
  await expect(page.locator("#rank .badge")).toHaveClass(/jump/);
  await expect(page.locator("#coins b")).not.toHaveClass(/jump/);

  await expect.poll(() => log(page).then((l) => l.length)).toBe(2);
  const [up, down] = await log(page);
  expect(up).toMatchObject({ what: "star", shown: true, text: "+1", motion: "pop", quiet: "true" });
  expect(Math.abs(up.x - up.warden.x)).toBeLessThan(3);
  expect(up.y).toBeLessThan(up.warden.y);
  expect(down).toMatchObject({ what: "star", shown: false });
});

test("a pad bought opens a ring on the pad, and paying for it floats nothing", async ({ page }) => {
  await page.goto("/");
  const world = await started(page);
  expect(await page.evaluate(() => window.__jailbirds.camera().turn)).toBe(0);
  // the warden stands on the edge of the pad, to its right, with coins to spare
  await reopen(page, world, { coins: 50, warden: { x: CELL3.x + 18, y: CELL3.y } });
  const bought = await untilSim(page, (s) => s.bought.includes("cell3"), 5, "the cell to be bought");
  await expect.poll(() => tally(page)).toEqual({ coins: 0, stars: 0, rings: 1 });
  await expect(page.locator("#coins b")).toHaveText(String(bought.coins));
  expect(bought.coins).toBeLessThan(50);
  await expect(page.locator("#coins b")).not.toHaveClass(/jump/);

  await expect.poll(() => log(page).then((l) => l.length)).toBe(2);
  const [up, down] = await log(page);
  expect(up).toMatchObject({ what: "ring", shown: true, display: "block", motion: "ring", quiet: "true" });
  // on the pad, at the floor: left of the warden and lower than his middle
  expect(up.x).toBeLessThan(up.warden.x - 4);
  expect(up.x).toBeGreaterThan(up.warden.x - 60);
  expect(up.y).toBeGreaterThan(up.warden.y);
  expect(up.y).toBeLessThan(up.warden.y + 60);
  expect(down).toMatchObject({ what: "ring", shown: false });
  expect(down.at - up.at).toBeGreaterThan(550);
});

test("with less motion a +7 shows and goes without floating, counts do not jump and no ring opens", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const world = await started(page);
  await reopen(page, world, { coins: 0, piles: { desk: 7 }, warden: { x: 115, y: 700 } });
  await started(page);
  await walkTo(page, PILE, 12);
  await untilSim(page, (s) => s.coins === 7, 2, "the pile to be picked up");
  await expect(page.locator("#coins b")).toHaveText("7");
  await expect(page.locator("#coins b")).toHaveClass(/jump/);
  expect(await motion(page.locator("#coins b"))).toBe("none");
  await expect.poll(() => log(page).then((l) => l.length)).toBe(2);
  const [up, down] = await log(page);
  expect(up).toMatchObject({ what: "coin", shown: true, text: "+7", display: "flex", motion: "none" });
  expect(Math.abs(up.x - up.warden.x)).toBeLessThan(3);
  expect(up.y).toBeLessThan(up.warden.y);
  expect(down.at - up.at).toBeGreaterThan(850);

  await reopen(page, world, { coins: 50, warden: { x: CELL3.x + 18, y: CELL3.y } });
  await untilSim(page, (s) => s.bought.includes("cell3"), 5, "the cell to be bought");
  // the ring is counted, and never drawn
  await expect.poll(() => tally(page)).toEqual({ coins: 0, stars: 0, rings: 1 });
  await expect.poll(() => log(page).then((l) => l.length)).toBe(2);
  const [ring] = await log(page);
  expect(ring).toMatchObject({ what: "ring", shown: true, display: "none" });
});
