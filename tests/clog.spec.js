import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures.js";
import { waitFrames } from "./helpers.js";

// a clogged toilet, drawn at the toilet, and an upset resident's cloud. each look starts from a
// save: an old jail with the ride kept away, the warden at the first cell's door and two at home
const OLD = JSON.parse(readFileSync(new URL("./fixtures/v0.1.21-save.json", import.meta.url), "utf8"));
const resident = (id, slot, unrest) => ({
  id, kind: "agent", x: 46, y: slot ? 110 : 58, face: 1, moving: false, walk: 0, look: id % 6, tags: ["uniform"], state: "home",
  leader: -1, house: "c0", slot, station: "", seat: -1, needs: { food: 1, wash: 1, toilet: 1 }, unrest, served: 0, rest: 0, t: 0,
  carry: 0, cash: 0, path: [], trail: [],
});
const jail = (over = {}, unrest = 0) => ({
  ...OLD, ride: { state: "away", x: -100, t: 9999 }, fightIn: 9999, nextId: 60,
  agents: [{ ...OLD.agents[0], x: 67, y: 176 }, resident(50, 0, unrest), resident(51, 1, unrest)], ...over,
});
const drawn = (page) => page.evaluate(() => window.__jailbirds.drawn());
const state = (page) => page.evaluate(() => window.__jailbirds.state());

async function open(page, save) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript((first) => {
    const next = sessionStorage.getItem("jb:next") ?? (sessionStorage.getItem("jb:went") ? null : first);
    sessionStorage.setItem("jb:went", "1");
    sessionStorage.removeItem("jb:next");
    if (next) localStorage.setItem("jailbirds:save", next);
  }, JSON.stringify(save));
  await page.goto("/");
  await waitFrames(page, 6);
  return errors;
}
async function reopen(page, save) {
  await page.evaluate((s) => sessionStorage.setItem("jb:next", s), JSON.stringify(save));
  await page.reload();
  await waitFrames(page, 6);
}

test("a clogged toilet is drawn at the toilet, more as it gets worse, and an upset head gets a cloud", async ({ page }) => {
  const errors = await open(page, jail());
  const plain = (await drawn(page)).triangles;
  const seen = [];
  for (const level of [1, 2.5, 4]) {
    await reopen(page, jail({ dirt: { "toilets:0": { level, clean: 0, removed: 0 } } }));
    expect((await state(page)).dirt["toilets:0"].level).toBeGreaterThanOrEqual(level);
    seen.push((await drawn(page)).triangles);
  }
  expect(seen[0]).toBeGreaterThan(plain);
  expect(seen[1]).toBeGreaterThan(seen[0]);
  expect(seen[2]).toBeGreaterThan(seen[1]);
  // the same jail with both of them upset: two clouds more, and nothing else
  await reopen(page, jail({ dirt: { "toilets:0": { level: 4, clean: 0, removed: 0 } } }, 1));
  const s = await state(page);
  expect(s.agents.filter((a) => a.kind === "agent").every((a) => a.unrest > 0.9)).toBe(true);
  expect((await drawn(page)).triangles).toBeGreaterThan(seen[2]);
  expect(errors).toEqual([]);
});

test("an old save's poop on a toilet comes back as that toilet's dirt, not a mess on the floor", async ({ page }) => {
  const poop = { id: 55, kind: "poop", x: 80, y: 108, station: "toilets", seat: 0, clean: 0.2 };
  const errors = await open(page, jail({ messes: [poop] }));
  const s = await state(page);
  expect(s.messes).toEqual([]);
  expect(s.dirt["toilets:0"].level).toBeGreaterThanOrEqual(1);
  expect(s.dirt["toilets:0"].removed).toBe(0);
  expect(s.coins).toBe(OLD.coins);
  expect(errors).toEqual([]);
});
