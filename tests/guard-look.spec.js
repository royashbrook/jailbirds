import { test, expect } from "./fixtures.js";
import { squabbleAt, untilSim, waitFrames } from "./helpers.js";
import { create } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";

// the riot guard on the screen: hired, it walks to a squabble on its own and calms it with the warden far
// away. the shots are for a person to read the helmet, shield and whistle; the checks are the game's own
const L = LEVELS[0];

test("a hired riot guard walks to a squabble and calms it with the warden nowhere near", async ({ page, browserName }, info) => {
  const w = create(LEVELS, 0, 5);
  w.rank = 5;
  w.bought = ["cell3", "cell4", "hospital", "riotguard"];
  w.ride = { state: "away", x: -100, t: 1e9 };
  // the warden in the corridor, in sight of the first cell but well out of reach of its squabble
  Object.assign(w.agents[0], { x: 160, y: 220 });
  const guard = {
    id: w.nextId++, kind: "calmer", x: L.helperHome.x, y: L.helperHome.y, face: 1, moving: false, walk: 0, look: 0, tags: [], state: "idle",
    leader: -1, house: "", slot: -1, station: "", seat: -1, needs: {}, unrest: 0, served: 0, hurt: 0, rest: 0, t: 0, carry: 0, cash: 0,
    path: [], trail: [],
  };
  w.agents.push(guard);
  const at = L.stations.find((s) => s.id === "c0").at;
  const { others, ...q } = squabbleAt(w, at);
  const save = { ...w, ...q, agents: [w.agents[0], ...others] };
  await page.addInitScript((raw) => {
    localStorage.removeItem("jailbirds:map");
    localStorage.setItem("jailbirds:save", raw);
  }, JSON.stringify(save));
  await page.goto("/");
  const s = await untilSim(page, (x) => x.steps > 5, 2, "the game to start");
  expect(s.alert?.kind).toBe("squabble");
  expect(s.agents.filter((a) => a.kind === "calmer")).toHaveLength(1);
  await untilSim(page, (x) => Math.hypot(x.agents.find((a) => a.kind === "calmer").x - at.x, x.agents.find((a) => a.kind === "calmer").y - at.y) < 40, 15, "the guard to get there");
  await waitFrames(page, 10);
  await page.screenshot({ path: info.outputPath(`guard-${browserName}.png`) });
  const done = await untilSim(page, (x) => x.alert === null, 5, "the guard to calm it");
  expect(Math.hypot(done.agents[0].x - at.x, done.agents[0].y - at.y), "the warden never in reach").toBeGreaterThan(80);
  expect(done.settled).toBe(save.settled + 1);
});
