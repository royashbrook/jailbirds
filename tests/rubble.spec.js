import { test, expect } from "./fixtures.js";
import { byId, state, untilSim, waitFrames, waitSim, walkTo } from "./helpers.js";
import { create } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";

// the cells still to open are full of rubble. paying a cell's pad clears it: the sim opens the cell the
// moment the last coin goes in, and the view shows the rubble tumbling away once (or, with less
// motion, a quiet glow). what the view drew is read off window.__jailbirds.drawn().rubble, never
// off three.js itself
const CELLS = ["cell3", "cell4", "cell5", "cell6", "cell7", "cell8"];
const ROOMS = ["c2", "c3", "c4", "c5", "c6", "c7"];
const pad = (id) => LEVELS[0].pads.find((p) => p.id === id);
const rubble = (page) => page.evaluate(() => window.__jailbirds.drawn().rubble);
const drawn = (page) => page.evaluate(() => window.__jailbirds.drawn());
const crowd = (page) => page.locator("#crowd b");
const started = (page) => untilSim(page, (s) => s.steps > 5, 2, "the game to start");

/** a jail 1 world with nothing coming or going on its own, the warden standing on a spot */
function world(change, at) {
  const w = create(LEVELS, 0, 321);
  Object.assign(w, { ride: { state: "away", x: -100, t: 9999 }, fightIn: 9999, boost: { x: 0, y: 0, here: false, t: 9999 } }, change);
  Object.assign(w.agents[0], at);
  return w;
}
/** someone checked in and following the warden, nothing wanted but what `needs` says */
const follower = (id, at, needs = {}) => ({
  id, kind: "agent", x: at.x, y: at.y, face: 1, moving: false, walk: 0, look: 2, tags: ["uniform"], state: "follow", leader: 1,
  house: "", slot: -1, station: "", seat: -1, needs: { food: 1, wash: 1, toilet: 1, ...needs }, unrest: 0, served: 0, rest: 0, t: 0,
  carry: 0, cash: 0, path: [], trail: [],
});
/** an old one-jail save, put in before every load of the page */
async function seedEveryLoad(page, w) {
  await page.addInitScript((raw) => {
    localStorage.removeItem("jailbirds:map");
    localStorage.setItem("jailbirds:save", raw);
  }, JSON.stringify(w));
}
/** a map record with both jails open, put in once, so a reload loads what the game saved since */
async function seedMapOnce(page, w) {
  await page.goto("/manifest.json");
  await page.evaluate((raw) => {
    localStorage.clear();
    localStorage.setItem("jailbirds:map", raw);
  }, JSON.stringify({ v: 1, gen: 1, active: "jail1", unlocked: ["jail1", "jail2"], worlds: { jail1: w } }));
}

test("paying a clear cell pad opens the cell the moment it is paid: two beds, its toilet, charged once", async ({ page, browserName }) => {
  const at = { x: pad("cell3").at.x + 10, y: pad("cell3").at.y };
  const w = world({ coins: 20, nextId: 3 }, at);
  w.agents.push(follower(2, { x: at.x, y: at.y + 16 }, { toilet: 0.1 }));
  await seedEveryLoad(page, w);
  await page.goto("/");
  await started(page);
  // all six still to clear, drawn as rubble, and the tag says what paying does
  const before = await rubble(page);
  expect(before.rooms).toEqual(ROOMS);
  expect(before.stones).toBeGreaterThan(6 * 12);
  expect(before.revealed).toEqual([]);
  await expect(crowd(page)).toHaveText(/\/4$/);
  await expect(page.locator(".tag:not([hidden])", { hasText: "clear cell" }).first()).toBeVisible();

  // paid coin by coin; never paid in full and still shut, never open and short
  const seen = [];
  const paid = await untilSim(page, (s) => {
    seen.push({ paid: s.paid.cell3 ?? 0, open: s.bought.includes("cell3"), coins: s.coins });
    return s.bought.includes("cell3");
  }, 5, "the cell to be paid for");
  for (const s of seen) expect(s.open, JSON.stringify(s)).toBe(s.paid >= 8);
  expect(seen.some((s) => s.paid > 0 && s.paid < 8)).toBe(true);
  expect(paid.paid.cell3).toBe(8);
  expect(paid.coins).toBe(12);
  expect(paid.bought).toEqual(["cell3"]);
  await expect(crowd(page)).toHaveText(/\/6$/);

  // the view: that cell's rubble gone, the others still there, one clearing shown, and the still parts
  // rebuilt once for the purchase, not once a coin
  await expect.poll(async () => (await rubble(page)).revealed.map((r) => r.room)).toEqual(["c2"]);
  const after = await rubble(page);
  expect(after.rooms).toEqual(ROOMS.slice(1));
  expect(after.stones).toBeLessThan(before.stones);
  expect(after.builds).toBe(before.builds + 1);
  expect(after.revealed[0]).toMatchObject({ room: "c2", quiet: false });
  expect(after.revealed[0].rocks).toBeGreaterThan(0);
  // and it is over in well under a second, having cost a couple of draw calls while it lasted
  await expect.poll(async () => (await rubble(page)).clearing, { timeout: 3000 }).toEqual([]);
  const cost = (await rubble(page)).revealed[0], calm = await drawn(page);
  console.log(`rubble clearing ${browserName} ${JSON.stringify({ ...cost, after: calm.calls })}`);
  expect(cost.calls - calm.calls).toBeLessThanOrEqual(3);

  // the one following him moves into the new cell, walks in through its door, uses its toilet (she
  // needs it, so that is the first thing she does once in) and goes back to her bed
  const given = await untilSim(page, (s) => byId(s, 2).house === "c2", 5, "the newcomer to be given a bed in c2");
  expect(byId(given, 2).slot).toBeGreaterThanOrEqual(0);
  await untilSim(page, (s) => byId(s, 2).state === "use" && byId(s, 2).station === "toilets" && byId(s, 2).seat === 2, 30, "c2's own toilet to be used");
  await untilSim(page, (s) => byId(s, 2).house === "c2" && byId(s, 2).state === "home", 15, "her to be back in bed in c2");

  // paid once: nothing more taken for it, its pad gone, the next one not touched
  const later = await waitSim(page, 1);
  expect(later.paid.cell3).toBe(8);
  expect(later.bought.filter((id) => id === "cell3")).toEqual(["cell3"]);
  expect(later.paid.cell4 ?? 0).toBe(0);
  expect((await rubble(page)).revealed.map((r) => r.room)).toEqual(["c2"]);
});

test("standing on a clear cell pad with no money, or before its level, does nothing and shows nothing", async ({ page }) => {
  // no money
  await seedEveryLoad(page, world({ coins: 0 }, { x: pad("cell3").at.x, y: pad("cell3").at.y }));
  await page.goto("/");
  await started(page);
  const builds = (await rubble(page)).builds;
  const broke = await waitSim(page, 2);
  expect(broke.bought).toEqual([]);
  expect(broke.paid.cell3 ?? 0).toBe(0);
  const r = await rubble(page);
  expect(r.rooms).toEqual(ROOMS);
  expect(r.revealed).toEqual([]);
  expect(r.builds).toBe(builds);

  // money, but the next cell wants level 2
  const page2 = await page.context().newPage();
  await seedEveryLoad(page2, world({ coins: 50, rank: 1, bought: ["cell3"] }, { x: pad("cell4").at.x, y: pad("cell4").at.y }));
  await page2.goto("/");
  await started(page2);
  await expect(page2.locator(".tag.locked:not([hidden])", { hasText: "clear cell" }).first()).toContainText("lv 2");
  const early = await waitSim(page2, 2);
  expect(early.coins).toBe(50);
  expect(early.paid.cell4 ?? 0).toBe(0);
  expect(early.bought).toEqual(["cell3"]);
  const r2 = await rubble(page2);
  expect(r2.rooms).toEqual(ROOMS.slice(1));
  expect(r2.revealed).toEqual([]);
  await page2.close();
});

test("a cell cleared stays cleared and never shows clearing again: leaving mid-clear, travel, reload, start over", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await seedMapOnce(page, world({ coins: 300, rank: 6, bought: ["next"] }, { x: pad("cell3").at.x, y: pad("cell3").at.y }));
  // off to desert rock from inside a frame where c2 is still tumbling, so the trip always
  // leaves mid-clear, however slow the runner. a click from the test could come after it ended
  await page.addInitScript(() => {
    const watch = () => {
      const api = window.__jailbirds;
      // the first frame seen in desert rock, before any clearing could have run out on its own
      const left = window.__left;
      if (left?.atGo && !left.there && api.map().active === "jail2") left.there = api.drawn().rubble.clearing;
      if (!window.__left && api?.drawn().rubble?.clearing.includes("c2")) {
        const s = api.state();
        window.__left = { clearing: api.drawn().rubble.clearing, coins: s.coins, bought: s.bought.includes("cell3") };
        document.querySelector("#map").click();
        queueMicrotask(() => {
          window.__left.atGo = api.drawn().rubble.clearing;
          document.querySelector('[data-jail="jail2"] .go').click();
        });
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.goto("/");
  // the trip goes on its own, so the wait is for desert rock: c2 was bought and still clearing
  // at the map click and at go
  await expect(page.locator("#place")).toHaveText("desert rock", { timeout: 20000 });
  await page.waitForFunction(() => window.__left.there);
  const paid = await page.evaluate(() => window.__left);
  expect(paid).toMatchObject({ clearing: ["c2"], atGo: ["c2"], bought: true, there: [] });
  await waitFrames(page, 3);
  const there = await rubble(page);
  expect(there.clearing).toEqual([]);
  expect(there.rooms).toEqual(ROOMS);
  expect(there.revealed.map((r) => r.room)).toEqual(["c2"]);

  // and back: the cell is open, paid once, and nothing shows clearing again
  await page.click("#map");
  await page.click('[data-jail="jail1"] .go');
  await expect(page.locator("#place")).toHaveText("pine hill");
  await waitFrames(page, 5);
  const back = await state(page);
  expect(back.bought.filter((id) => id === "cell3")).toEqual(["cell3"]);
  expect(back.paid.cell3).toBe(8);
  expect(back.coins).toBe(paid.coins);
  expect((await rubble(page)).rooms).toEqual(ROOMS.slice(1));
  expect((await rubble(page)).revealed.map((r) => r.room)).toEqual(["c2"]);

  // a reload: still open, nothing clearing
  await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem("jailbirds:map"))).worlds.jail1.bought).toContain("cell3");
  await page.reload();
  await started(page);
  await waitFrames(page, 5);
  const reloaded = await rubble(page);
  expect(reloaded.rooms).toEqual(ROOMS.slice(1));
  expect(reloaded.revealed).toEqual([]);
  await expect(crowd(page)).toHaveText(/\/6$/);

  // the next cell bought after all that shows clearing, once
  await walkTo(page, pad("cell4").at, 4);
  await untilSim(page, (s) => s.bought.includes("cell4"), 8, "the next cell to be paid for");
  await expect.poll(async () => (await rubble(page)).revealed.map((r) => r.room)).toEqual(["c3"]);

  // start over: this jail's cells go back to rubble, and nothing shows clearing
  await page.click("#about");
  await page.click("#restart");
  await page.click("#confirm-restart");
  await expect(page.locator("dialog")).toHaveCount(0);
  await waitFrames(page, 5);
  const fresh = await rubble(page);
  expect(fresh.rooms).toEqual(ROOMS);
  expect(fresh.revealed.map((r) => r.room)).toEqual(["c3"]);
  expect(fresh.clearing).toEqual([]);
  await expect(crowd(page)).toHaveText(/\/4$/);
  expect(errors).toEqual([]);
});

test("with less motion a cleared cell glows a moment, nothing flies, and it opens just the same", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedEveryLoad(page, world({ coins: 20 }, { x: pad("cell3").at.x, y: pad("cell3").at.y }));
  await page.goto("/");
  await started(page);
  const s = await untilSim(page, (x) => x.bought.includes("cell3"), 5, "the cell to be paid for");
  expect(s.coins).toBe(12);
  await expect.poll(async () => (await rubble(page)).revealed).toHaveLength(1);
  const [shown] = (await rubble(page)).revealed;
  expect(shown).toMatchObject({ room: "c2", quiet: true, rocks: 0 });
  expect(shown.glow).toBeGreaterThan(0);
  expect((await rubble(page)).rooms).toEqual(ROOMS.slice(1));
  await expect.poll(async () => (await rubble(page)).clearing, { timeout: 3000 }).toEqual([]);
});

test("four beds with every cell full of rubble, sixteen with all six cleared; what it costs to draw", async ({ page, browserName }) => {
  const measure = async (bought) => {
    const p = await page.context().newPage();
    await seedEveryLoad(p, world({ rank: 6, bought }, { x: 400, y: 200 }));
    await p.goto("/");
    await started(p);
    await waitFrames(p, 20);
    const d = await drawn(p);
    const beds = await crowd(p).textContent();
    await p.close();
    return { calls: d.calls, triangles: d.triangles, geometries: d.geometries, textures: d.textures, programs: d.programs, rooms: d.rubble.rooms, stones: d.rubble.stones, beds };
  };
  const shut = await measure([]), open = await measure(CELLS);
  console.log(`rubble draw ${browserName} shut ${JSON.stringify(shut)}`);
  console.log(`rubble draw ${browserName} open ${JSON.stringify(open)}`);
  expect(shut.beds).toBe("0/4");
  expect(shut.rooms).toEqual(ROOMS);
  expect(open.beds).toBe("0/16");
  expect(open.rooms).toEqual([]);
  expect(open.stones).toBe(0);
  // every stone of every heap is one instanced mesh: one draw call and one geometry more, at most
  expect(shut.calls - open.calls).toBeLessThanOrEqual(3);
  expect(shut.geometries - open.geometries).toBeLessThanOrEqual(2);
  expect(shut.calls).toBeLessThan(80);
});

test("drawn again and again (night and day) the rubble is rebuilt in place: nothing piles up, nothing replays", async ({ page }) => {
  await seedEveryLoad(page, world({ coins: 0 }, { x: 400, y: 200 }));
  await page.goto("/");
  await started(page);
  await waitFrames(page, 5);
  const first = await drawn(page);
  for (const scheme of ["dark", "light", "dark", "light"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await waitFrames(page, 3);
  }
  const last = await drawn(page);
  expect(last.rubble.builds).toBe(first.rubble.builds + 4);
  expect(last.rubble.rooms).toEqual(ROOMS);
  expect(last.rubble.revealed).toEqual([]);
  expect(last.geometries).toBe(first.geometries);
  expect(last.textures).toBe(first.textures);
});
