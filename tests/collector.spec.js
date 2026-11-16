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
    // an old save, on a device with no map yet: it is moved over as the page opens
    if (next) {
      localStorage.removeItem("jailbirds:map");
      localStorage.setItem("jailbirds:save", next);
    }
  }, JSON.stringify(s));
  await page.goto("/");
  await waitFrames(page, 6);
  return errors;
}

// holds the reload's load event back 6s, longer than the whole walk to the safe (about 2.5s of
// game time): the manifest for engines that wait on it, and a slow image for those that do not
async function slowReload(page) {
  await page.route("**/manifest.json", async (r) => { await new Promise((ok) => setTimeout(ok, 6000)); await r.continue(); });
  await page.route("**/__slow.png", async (r) => {
    await new Promise((ok) => setTimeout(ok, 6000));
    await r.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") });
  });
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const i = new Image(); i.src = "/__slow.png"; document.body.append(i); }));
}

test("the safe stands by intake, and a collector carrying coins to it has a bag", ({ page }) => bagJourney(page, false));
test.describe("a slow reload", () => {
  // a service worker would answer the delayed requests from its cache, out of the route's reach
  test.use({ serviceWorkers: "block" });
  test("the collector's bag is still seen when the reload outlasts the walk", ({ page }) => bagJourney(page, true));
});

async function bagJourney(page, slow) {
  const errors = await open(page, save(0));
  const s = await state(page);
  expect(s.piles.safe).toBe(6);
  expect(s.agents.find((a) => a.kind === "collector").cash).toBe(0);
  const plain = (await drawn(page)).triangles;
  // the same jail with coins on the desk: the collector picks them up and walks off with a bag.
  // the game runs while the page loads, and a reload can outlast the whole walk (one slow request
  // kept 0.1.181's open for 11s), so the new page watches itself from its first frame: it latches
  // the first frame where the collector holds the desk's 12 coins and its bag is drawn
  await page.addInitScript((plain) => {
    const look = () => {
      const jb = window.__jailbirds;
      const holding = jb?.state().agents.find((a) => a.kind === "collector")?.cash === 12;
      if (holding && jb.drawn().triangles > plain) window.__bag = { steps: jb.state().steps, triangles: jb.drawn().triangles };
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }, plain);
  await page.evaluate((next) => sessionStorage.setItem("jb:next", next), JSON.stringify(save(12)));
  if (slow) await slowReload(page);
  const t0 = Date.now();
  await page.reload();
  // the slow case is only a proof if the load really outlasted the walk
  if (slow) expect(Date.now() - t0, "the reload outlasted the walk").toBeGreaterThan(3000);
  const carried = await untilSim(page, (w) => w.piles.safe === 18, 30, "the coins in the safe");
  expect(await page.evaluate(() => window.__bag), "the collector seen holding the 12 coins with its bag drawn").toBeTruthy();
  expect(carried.agents.find((a) => a.kind === "collector").cash).toBe(0);
  expect(carried.coins).toBe(OLD.coins);
  await waitFrames(page, 3);
  expect(errors).toEqual([]);
}
