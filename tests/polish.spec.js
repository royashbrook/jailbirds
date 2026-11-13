import { test, expect } from "./fixtures.js";
import { queued, state, untilSim, walkTo } from "./helpers.js";

// the little things that say "you got it": a "+7" off the warden, a count that jumps,
// a ring where a pad was bought. when each shows and for how long is tests/overlay.test.mjs;
// this is the page: what the game hands them, where they sit, and less motion.
// a "+7" is up for under a second, so the page itself writes down each one as it
// shows and as it goes, and the test reads that, never racing the clock.
// what is looked at is the part that moves: the label inside a "+7", and for a ring the
// spot it opens from. the ring itself is drawn by that spot, as a thing with no box to ask
// after, so how it is hung on the spot is read from its style. a count that jumps is
// put in anew with its jump on it, so each jump is counted as it is put in.
function watch() {
  const log = (window.__pops = []), jumps = (window.__jumps = { coins: 0, stars: 0 });
  new MutationObserver((list) => {
    for (const { target: el, addedNodes } of list) {
      for (const node of addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches("#coins b.jump")) jumps.coins++;
        if (node.matches("#rank .badge.jump")) jumps.stars++;
      }
      if (!el.classList || !el.classList.contains("pop") && !el.classList.contains("ring")) continue;
      const ring = el.classList.contains("ring"), part = ring ? el : el.firstElementChild;
      const box = part.getBoundingClientRect(), root = el.parentElement.getBoundingClientRect();
      log.push({
        what: ring ? "ring" : el.classList.contains("star") ? "star" : "coin",
        shown: !el.hidden, text: el.textContent, at: performance.now(),
        x: box.x + box.width / 2 - root.x, y: box.y + box.height / 2 - root.y,
        display: getComputedStyle(part).display, motion: getComputedStyle(part, ring ? "::before" : null).animationName,
        quiet: el.getAttribute("aria-hidden"),
        mark: ring ? "" : getComputedStyle(part, "::after").backgroundImage === "none" ? "coin" : "star",
        hung: ring ? ["left", "top", "translate"].map((key) => getComputedStyle(part, "::before")[key]) : [],
        warden: window.__jailbirds.warden(),
      });
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
}
const log = (page) => page.evaluate(() => window.__pops);
const tally = (page) => page.evaluate(() => window.__jailbirds.pops());
const jumps = (page) => page.evaluate(() => window.__jumps);
const motion = (locator) => locator.evaluate((el) => getComputedStyle(el).animationName);
const PILE = { x: 50, y: 700 }, LOOSE = { x: 180, y: 700 }, STAMP = { x: 600, y: 704 }, CELL3 = { x: 235, y: 184 }, LINE1 = { x: 320, y: 590 };

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

test("coins picked up float a +7 off the warden and the count jumps, each time", async ({ page }) => {
  await page.goto("/");
  // a pile of seven to his left and one loose coin to his right
  await reopen(page, await started(page), { coins: 0, piles: { desk: 7 }, floor: [{ ...LOOSE, house: "" }], warden: { x: 115, y: 700 } });
  await started(page);
  expect(await tally(page)).toEqual({ coins: 0, stars: 0, rings: 0 });
  expect(await jumps(page)).toEqual({ coins: 0, stars: 0 });
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
  expect(await jumps(page)).toEqual({ coins: 1, stars: 0 });

  // one "+7", with a coin and not a star, over the warden, and gone in its time
  await expect.poll(() => log(page).then((l) => l.length)).toBe(2);
  const [up, down] = await log(page);
  expect(up).toMatchObject({ what: "coin", mark: "coin", shown: true, text: "+7", display: "flex", motion: "pop", quiet: "true" });
  expect(Math.abs(up.x - up.warden.x)).toBeLessThan(3);
  expect(up.y).toBeLessThan(up.warden.y);
  expect(up.y).toBeGreaterThan(up.warden.y - 120);
  expect(down).toMatchObject({ what: "coin", shown: false, text: "+7" });
  expect(down.at - up.at).toBeGreaterThan(850);

  // one more coin, and the count jumps again
  await walkTo(page, LOOSE, 12);
  await untilSim(page, (s) => s.coins === 8, 2, "the loose coin to be picked up");
  await expect(page.locator("#coins b")).toHaveText("8");
  await expect.poll(() => jumps(page)).toEqual({ coins: 2, stars: 0 });
  expect(await tally(page)).toEqual({ coins: 8, stars: 0, rings: 0 });
  await expect.poll(() => log(page).then((l) => l.filter((p) => p.shown).map((p) => p.text))).toEqual(["+7", "+1"]);
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
  expect(await jumps(page)).toEqual({ coins: 0, stars: 1 });

  await expect.poll(() => log(page).then((l) => l.length)).toBe(2);
  const [up, down] = await log(page);
  expect(up).toMatchObject({ what: "star", mark: "star", shown: true, text: "+1", motion: "pop", quiet: "true" });
  expect(Math.abs(up.x - up.warden.x)).toBeLessThan(3);
  expect(up.y).toBeLessThan(up.warden.y);
  expect(down).toMatchObject({ what: "star", shown: false });
});

test("the star that levels her up shows with the coins it pays, the star a line above", async ({ page }) => {
  await page.goto("/");
  const world = await untilSim(page, (s) => queued(s).length === 3, 20, "the first bus to queue up");
  const [done, ...rest] = world.agents.slice(1);
  const led = { ...done, state: "follow", leader: world.agents[0].id, house: "c0", slot: 0, served: 999, x: STAMP.x, y: STAMP.y - 16, path: [] };
  // one star short of the next level
  await reopen(page, world, { coins: 0, stars: 1, warden: STAMP, others: [led, ...rest] });
  const after = await untilSim(page, (s) => s.released === 1, 3, "the release");
  expect(after.rank).toBe(world.rank + 1);
  expect(after.coins).toBeGreaterThan(0);
  await expect.poll(() => tally(page)).toEqual({ coins: after.coins, stars: 1, rings: 0 });
  await expect.poll(() => jumps(page)).toEqual({ coins: 1, stars: 1 });

  await expect.poll(() => log(page).then((l) => l.length)).toBe(4);
  const ups = (await log(page)).filter((p) => p.shown);
  const star = ups.find((p) => p.what === "star"), coin = ups.find((p) => p.what === "coin");
  expect(star).toMatchObject({ mark: "star", text: "+1" });
  expect(coin).toMatchObject({ mark: "coin", text: `+${after.coins}` });
  expect(Math.abs(star.x - coin.x)).toBeLessThan(3);
  expect(star.y).toBeLessThan(coin.y - 15);
});

test("a pad bought opens a ring on the pad, and paying for it floats nothing", async ({ page }) => {
  await page.goto("/");
  const world = await started(page);
  // the warden stands on the edge of a pad, to one side of its middle, with coins to spare.
  // it is not the first pad of the level, and the first is a long way off
  await reopen(page, world, { coins: 50, warden: { x: LINE1.x + 18, y: LINE1.y } });
  const bought = await untilSim(page, (s) => s.bought.includes("line1"), 5, "the longer line to be bought");
  expect(bought.bought).toEqual(["line1"]);
  await expect.poll(() => tally(page)).toEqual({ coins: 0, stars: 0, rings: 1 });
  await expect(page.locator("#coins b")).toHaveText(String(bought.coins));
  expect(bought.coins).toBeLessThan(50);
  await expect(page.locator("#coins b")).not.toHaveClass(/jump/);
  expect(await jumps(page)).toEqual({ coins: 0, stars: 0 });

  await expect.poll(() => log(page).then((l) => l.length)).toBe(2);
  const [up, down] = await log(page);
  expect(up).toMatchObject({ what: "ring", shown: true, display: "block", motion: "ring", quiet: "true" });
  // its middle is on the spot: it starts at the spot and is pulled back by half of itself
  expect(up.hung).toEqual(["0px", "0px", "-50% -50%"]);
  // on the pad beside him: near the warden, and not on him
  expect(Math.abs(up.x - up.warden.x)).toBeGreaterThan(4);
  expect(Math.hypot(up.x - up.warden.x, up.y - up.warden.y)).toBeLessThan(60);
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

test("the squabble burst wobbles where it is, and does not slide about the screen", async ({ page }) => {
  await page.goto("/");
  // a squabble up the way from the warden and out of his reach, so it stays up
  await reopen(page, await started(page), { alert: { x: 330, y: 470, ids: [], held: 0 } });
  await started(page);
  const burst = page.locator(".overlay > .burst");
  await expect(burst).toBeVisible();
  // the shout takes turns through a list, so any of them
  await expect(burst.locator("b")).toHaveText(/^(hey!|watch this!|pow!|take that!|bonk!|oof!)$/);
  // a squabble in view has its shout, and no arrow on top of it
  await expect(page.locator(".overlay > .alert-arrow")).toHaveJSProperty("hidden", true);
  expect(await motion(burst.locator("b"))).toBe("wobble");
  // forty frames of it, once the camera has come to rest
  const seen = await page.evaluate(() => new Promise((done) => {
    const slot = document.querySelector(".overlay > .burst"), out = [];
    let was = "", same = 0;
    const look = () => {
      same = slot.style.transform === was ? same + 1 : 0;
      was = slot.style.transform;
      if (same < 20) return void requestAnimationFrame(look);
      const box = slot.firstElementChild.getBoundingClientRect(), spot = slot.getBoundingClientRect();
      out.push({ x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, put: was, spotX: spot.x, spotY: spot.y });
      out.length < 40 ? requestAnimationFrame(look) : done(out);
    };
    requestAnimationFrame(look);
  }));
  const spread = (key) => Math.max(...seen.map((s) => s[key])) - Math.min(...seen.map((s) => s[key]));
  expect(new Set(seen.map((s) => s.put)).size).toBe(1);
  expect(spread("w")).toBeGreaterThan(2);
  expect(spread("x")).toBeLessThan(1);
  expect(spread("y")).toBeLessThan(1);
  // and its middle is on the spot the view put it
  expect(Math.max(...seen.map((s) => Math.hypot(s.x - s.spotX, s.y - s.spotY)))).toBeLessThan(1);

  // and with less motion it holds still
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await motion(burst.locator("b"))).toBe("none");
});

test("a squabble off the screen gets the arrow pointing the way, and one in view does not", async ({ page }) => {
  await page.goto("/");
  const world = await started(page);
  // far from the warden, so the camera that follows him can't see it
  await reopen(page, world, { warden: { x: 60, y: 760 }, alert: { x: 780, y: 120, ids: [], held: 0 } });
  await started(page);
  const arrow = page.locator(".overlay > .alert-arrow");
  // the arrow itself has no box, its parts do: read whether it is shown
  await expect(arrow).toHaveJSProperty("hidden", false);
  await expect(arrow.locator("b")).toBeVisible();
  // walk the squabble right under him: now it is in view, the arrow goes and the shout is clear
  await reopen(page, world, { warden: { x: 330, y: 540 }, alert: { x: 330, y: 470, ids: [], held: 0 } });
  await started(page);
  await expect(page.locator(".overlay > .burst")).toBeVisible();
  await expect(arrow).toHaveJSProperty("hidden", true);
});
