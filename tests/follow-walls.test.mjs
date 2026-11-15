import { test } from "node:test";
import assert from "node:assert/strict";
import { create, step, player, isOpen, DT } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";
import { inside, walls } from "../src/engine/geom.ts";

// someone fetched from their bed by a guard walks out through the cell door and then along behind the
// guard, never through a wall: not while getting out, and not when the guard has already turned a corner
// by the time they are out. every cell, both beds, both jails, for a trip to care and for a meal
const STILL = { x: 0, y: 0 };
const ALL = ["cell3", "cell4", "cell5", "cell6", "cell7", "cell8", "hospital", "carebeds"];
/** how close the centre may come to a wall: a body measures about 4.2 either side of it */
const BODY = 4.2;

function trip(level, house, slot, kind) {
  const l = LEVELS[level];
  const w = create(LEVELS, level, 7);
  w.rank = 6;
  w.ride = { state: "away", x: -100, t: 1e9 };
  w.fightIn = 1e9;
  w.boost.t = 1e9;
  w.bought.push(...ALL);
  const home = l.stations.find((s) => s.id === house);
  const at = home.seats[slot].at;
  const needs = Object.fromEntries(l.needs.map((n) => [n.id, 1]));
  if (kind === "meal") needs.food = 0.2;
  const a = {
    id: w.nextId++, kind: "agent", x: at.x, y: at.y, face: 1, moving: false, walk: 0, look: 0, tags: ["uniform"], state: "home",
    leader: -1, house, slot, station: "", seat: -1, needs, unrest: 0, served: 11, hurt: kind === "care" ? 20 : 0, rest: 3, t: 0,
    carry: 0, cash: 0, path: [], trail: [],
  };
  w.agents.push(a);
  w.agents.push({
    id: w.nextId++, kind: "escort", x: home.at.x, y: home.at.y, face: 1, moving: false, walk: 0, look: 0, tags: [], state: "idle",
    leader: -1, house: "", slot: -1, station: "", seat: -1, needs: {}, unrest: 0, served: 0, hurt: 0, rest: 0, t: 0, carry: 0, cash: 0,
    path: [], trail: [],
  });
  // the player out of everyone's way
  Object.assign(player(w), { x: 740, y: 800 });
  const ws = walls(l, (r) => isOpen(w, r.locked), true);
  let led = false;
  for (let i = 0; i < 40 / DT; i++) {
    step(w, LEVELS, STILL);
    if (a.state === "follow") led = true;
    const hit = ws.find((r) => inside(a, r, BODY));
    assert.ok(!hit, `${l.id} ${house}/${slot} ${kind}: step ${i} at ${a.x.toFixed(2)},${a.y.toFixed(2)} inside a wall ${JSON.stringify(hit)}`);
    if (a.state === "use") return;
  }
  assert.fail(`${l.id} ${house}/${slot} ${kind}: never got there (led ${led}, now ${a.state})`);
}

for (const kind of ["care", "meal"])
  for (let level = 0; level < LEVELS.length; level++)
    test(`${LEVELS[level].id}: fetched from any bed for ${kind === "care" ? "care" : "a meal"}, never through a wall`, () => {
      for (let c = 0; c < 8; c++) for (const slot of [0, 1]) trip(level, `c${c}`, slot, kind);
    });
