import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures.js";
import { untilSim, waitFrames } from "./helpers.js";

// the safe and a collector carrying a bag to it, drawn. the page is read only, so this starts
// from a save: an old jail with a collector hired and standing by the desk's pile
const OLD = JSON.parse(readFileSync(new URL("./fixtures/v0.1.21-save.json", import.meta.url), "utf8"));
const warden = OLD.agents[0];
const collector = { ...warden, id: 2, kind: "collector", x: 50, y: 700, cash: 0 };
const save = (desk) => ({
  ...OLD, nextId: 3, rank: 5, bought: ["collector"],
  agents: [{ ...warden, x: 290, y: 760 }, collector],
  piles: { desk, safe: 6 },
  ride: { state: "away", x: -100, t: 9999 }, fightIn: 9999, boost: { x: 0, y: 0, here: false, t: 9999 },
});
const drawn = (page) => page.evaluate(() => window.__jailbirds.drawn());
const state = (page) => page.evaluate(() => window.__jailbirds.state());

async function open(page, s) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript((first) => {
    const next = sessionStorage.getItem("jb:next") ?? (sessionStorage.getItem("jb:went") ? null : first);
    sessionStorage.setItem("jb:went", "1");
    sessionStorage.removeItem("jb:next");
    if (next) localStorage.setItem("jailbirds:save", next);
  }, JSON.stringify(s));
  await page.goto("/");
  await waitFrames(page, 6);
  return errors;
}

test("the safe stands by intake, and a collector carrying coins to it has a bag", async ({ page }) => {
  const errors = await open(page, save(0));
  const s = await state(page);
  expect(s.piles.safe).toBe(6);
  expect(s.agents.find((a) => a.kind === "collector").cash).toBe(0);
  const plain = (await drawn(page)).triangles;
  // the same jail with coins on the desk: the collector picks them up and walks off with a bag
  await page.evaluate((next) => sessionStorage.setItem("jb:next", next), JSON.stringify(save(12)));
  await page.reload();
  await untilSim(page, (w) => w.agents.find((a) => a.kind === "collector")?.cash === 12, 5, "the collector to pick up the desk's coins");
  await waitFrames(page, 3);
  expect((await drawn(page)).triangles).toBeGreaterThan(plain);
  const carried = await untilSim(page, (w) => w.piles.safe === 18, 30, "the coins in the safe");
  expect(carried.agents.find((a) => a.kind === "collector").cash).toBe(0);
  expect(carried.coins).toBe(OLD.coins);
  await waitFrames(page, 3);
  expect(errors).toEqual([]);
});
