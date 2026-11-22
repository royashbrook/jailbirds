import { test, expect } from "./fixtures.js";
import { untilSim, waitFrames } from "./helpers.js";
import { create } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";

// what she sees: the nurse in the office, a red heart over whoever is sick, and the logo that is you
// and everyone you have hired, fitting beside the version on the narrowest phone
const L = LEVELS[0];
const HIRED = ["carrier", "escort", "clerk", "cleaner", "collector", "calmer"];

function world({ bought = ["cell3", "cell4", "hospital"], hired = HIRED, sick = "tummy", at = { x: 850, y: 410 } } = {}) {
  const w = create(LEVELS, 0, 5);
  Object.assign(w, { rank: 5, bought, fightIn: 1e9, sickIn: 1e9 });
  w.ride = { state: "away", x: -100, t: 1e9 };
  w.boost.t = 1e9;
  Object.assign(w.agents[0], at);
  for (const kind of hired)
    w.agents.push({
      id: w.nextId++, kind, x: L.helperHome.x, y: L.helperHome.y, face: 1, moving: false, walk: 0, look: 0, tags: [], state: "idle", leader: -1,
      house: "", slot: -1, station: "", seat: -1, needs: {}, unrest: 0, served: 0, hurt: 0, rest: 0, t: 0, carry: 0, cash: 0, path: [], trail: [],
    });
  if (sick) {
    const seat = L.stations.find((s) => s.id === "c7").seats[0].at;
    w.bought.push("cell5", "cell6", "cell7", "cell8");
    w.agents.push({
      id: w.nextId++, kind: "agent", x: seat.x, y: seat.y, face: 1, moving: false, walk: 0, look: 2, tags: ["uniform"], state: "home", leader: -1,
      house: "c7", slot: 0, station: "", seat: -1, needs: { food: 1, wash: 1, toilet: 1 }, unrest: 0, served: 10, hurt: L.riot.bump, sick, rest: 10,
      t: 0, carry: 0, cash: 0, path: [], trail: [],
    });
  }
  return w;
}
async function seed(page, w) {
  await page.addInitScript((raw) => {
    localStorage.removeItem("jailbirds:map");
    localStorage.setItem("jailbirds:save", raw);
  }, JSON.stringify(w));
  await page.goto("/");
  await untilSim(page, (s) => s.steps > 5, 2, "the game to start");
  await waitFrames(page, 20);
}
const crew = (page) => page.evaluate(() => [...document.querySelectorAll(".hud .logo [data-crew]")].map((e) => e.dataset.crew).sort());

test("the nurse is in the office, the sick one has a heart, and the tip says where to go", async ({ page, browserName }, info) => {
  await seed(page, world({ at: { x: 640, y: 200 } }));
  expect(await page.evaluate(() => window.__jailbirds.drawn().nurse)).toBe(true);
  const heart = page.locator('.bubble[data-need="sick"]:visible');
  await expect(heart).toHaveCount(1);
  expect(await heart.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain("e5383b");
  await expect(page.locator("#tip")).toContainText("tummy ache");
  await expect(page.locator("#tip")).toContainText("nurse");
  await page.screenshot({ path: info.outputPath(`sick-${browserName}.png`) });
});

test("no nurse is drawn before the office is bought, and the logo is just you", async ({ page }) => {
  await seed(page, world({ bought: ["cell3", "cell4"], hired: [], sick: "", at: { x: 330, y: 540 } }));
  expect(await page.evaluate(() => window.__jailbirds.drawn().nurse)).toBe(false);
  expect(await crew(page)).toEqual(["player"]);
});

for (const width of [320, 390]) {
  test(`${width} wide: the whole crew in the logo, on one row with the version`, async ({ page, browserName }, info) => {
    await page.setViewportSize({ width, height: 700 });
    await seed(page, world({ sick: "" }));
    expect(await crew(page)).toEqual(["calmer", "carrier", "cleaner", "clerk", "collector", "escort", "nurse", "player"]);
    const logo = await page.locator(".hud .logo .wordmark").boundingBox(), ver = await page.locator(".hud .corner").boundingBox();
    expect(logo.x).toBeGreaterThanOrEqual(0);
    expect(logo.x + logo.width).toBeLessThanOrEqual(ver.x + 0.5);
    expect(ver.x + ver.width).toBeLessThanOrEqual(width);
    expect(logo.height).toBeGreaterThan(20);
    await page.screenshot({ path: info.outputPath(`office-${width}-${browserName}.png`) });
  });
}
