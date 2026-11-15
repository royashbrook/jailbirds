import { test, expect } from "./fixtures.js";
import { untilSim, waitFrames } from "./helpers.js";
import { create } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";

// the care room as she sees it: rubble until bought; then beds, the bought ones in colour, one in use
// with someone resting in it. the shots are for a person to read; the checks are what the page says it drew
const L = LEVELS[0];
const seat = (i) => L.stations.find((s) => s.id === "hospital").seats[i].at;

function world(bought, inCare) {
  const w = create(LEVELS, 0, 5);
  w.rank = 5;
  w.bought = bought;
  Object.assign(w.agents[0], { x: 850, y: 560 });
  if (inCare) {
    const at = seat(0);
    w.agents.push({
      id: w.nextId++, kind: "agent", x: at.x, y: at.y, face: 1, moving: false, walk: 0, look: 2, tags: ["uniform"], state: "use",
      leader: -1, house: "c0", slot: 0, station: "hospital", seat: 0, needs: { food: 1, wash: 1, toilet: 1 }, unrest: 0, served: 10,
      hurt: 12, rest: 0, t: 0, carry: 0, cash: 0, path: [], trail: [],
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

test("the care room: rubble before it is bought, then beds, one with someone resting in it", async ({ page, browserName }, info) => {
  await seed(page, world(["cell3", "cell4"], false));
  expect((await page.evaluate(() => window.__jailbirds.drawn().rubble)).rooms).toContain("hospital");
  await page.screenshot({ path: info.outputPath(`care-shut-${browserName}.png`) });

  const ctx = await page.context().browser().newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const p = await ctx.newPage();
  await seed(p, world(["cell3", "cell4", "hospital"], true));
  const s = await untilSim(p, (x) => x.steps > 10, 2, "running");
  expect(s.agents.find((a) => a.station === "hospital")?.state).toBe("use");
  expect((await p.evaluate(() => window.__jailbirds.drawn().rubble)).rooms).not.toContain("hospital");
  await p.screenshot({ path: info.outputPath(`care-open-${browserName}.png`) });
  // she rests off the bump in the bed at the care rate, then walks home
  await untilSim(p, (x) => x.agents.find((a) => a.id === s.agents.at(-1).id)?.state !== "use", 8, "well again");
  await ctx.close();
});
