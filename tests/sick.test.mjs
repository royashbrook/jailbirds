import { test } from "node:test";
import assert from "node:assert/strict";
import { create, DT, hint, nurseAt, player, restore, step, UPSET } from "../src/engine/sim.ts";
import { LEVELS, hintText } from "../src/content/jail.ts";
import { CREW, crewIcon, crewMark, crewOf } from "../src/lib/crew.ts";

// people have to actually go to the nurse: once the room is bought someone may get sick. it does not
// rest off, they get sad and drop no money, a walk to the nurse fixes it, and nobody is ever lost
const STILL = { x: 0, y: 0 };
const L = LEVELS[0];
const steps = (w, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) step(w, LEVELS, STILL);
};
const until = (w, done, seconds, what) => {
  for (let i = 0; i < seconds / DT; i++) {
    if (done()) return;
    step(w, LEVELS, STILL);
  }
  assert.fail(`waited ${seconds}s for ${what}`);
};
const residents = (w) => w.agents.filter((a) => a.kind === "agent");
const HOMES = [["c0", 0], ["c0", 1], ["c1", 0], ["c1", 1]];
const hire = (w, kind) => {
  const g = { id: w.nextId++, kind, x: L.helperHome.x, y: L.helperHome.y, face: 1, moving: false, walk: 0, look: 0, tags: [], state: "idle",
    leader: -1, house: "", slot: -1, station: "", seat: -1, needs: {}, unrest: 0, served: 0, hurt: 0, rest: 0, t: 0, carry: 0, cash: 0, path: [], trail: [] };
  w.agents.push(g);
  return g;
};
/** a quiet jail with residents settled in their beds, no bus, no squabbles, no surprises */
function jail({ bought = ["hospital"], people = 2, sickIn = 0.05 } = {}) {
  const w = create(LEVELS, 0, 11);
  w.rank = 5;
  w.ride = { state: "away", x: -100, t: 1e9 };
  w.fightIn = 1e9;
  w.boost.t = 1e9;
  w.sickIn = sickIn;
  w.bought.push(...bought);
  for (let i = 0; i < people; i++) {
    const [house, slot] = HOMES[i];
    const at = L.stations.find((s) => s.id === house).seats[slot].at;
    w.agents.push({
      id: w.nextId++, kind: "agent", x: at.x, y: at.y, face: 1, moving: false, walk: 0, look: 0, tags: ["uniform"], state: "home", leader: -1,
      house, slot, station: "", seat: -1, needs: Object.fromEntries(L.needs.map((n) => [n.id, 1])), unrest: 0, served: 0, hurt: 0, rest: 10, t: 0,
      carry: 0, cash: 0, path: [], trail: [],
    });
  }
  Object.assign(player(w), { x: 330, y: 540 });
  return w;
}
const sick = (w) => residents(w).filter((a) => a.sick);

test("nobody gets sick before the nurse's office is bought", () => {
  const w = jail({ bought: [] });
  steps(w, 200);
  assert.equal(sick(w).length, 0);
  assert.equal(nurseAt(w, L), null);
});

test("with the office open someone gets sick, with something the game has words for", () => {
  const w = jail();
  assert.deepEqual(nurseAt(w, L), L.stations.find((s) => s.id === "hospital").keeper);
  until(w, () => sick(w).length > 0, 2, "someone sick");
  const a = sick(w)[0];
  assert.ok(L.sick.kinds.includes(a.sick));
  assert.ok(a.hurt > 0);
  for (const need of L.sick.kinds) assert.match(hintText({ key: "sick", need }, "birds"), /nurse/);
  assert.deepEqual(hint(w, L), { key: "sick", need: a.sick });
});

test("sick does not rest off: they stay in bed, make no money, get sad, and are never lost", () => {
  const w = jail({ people: 1 });
  until(w, () => sick(w).length === 1, 2, "someone sick");
  const a = sick(w)[0], hurt = a.hurt;
  w.floor = [];
  w.sickIn = 1e9;
  steps(w, 120);
  assert.equal(a.state, "home");
  assert.equal(a.hurt, hurt, "being sick never wears off by itself");
  assert.equal(w.floor.length, 0, "no money while sick");
  assert.ok(a.unrest >= UPSET, "they get sad");
  assert.equal(residents(w).length, 1, "nobody is lost");
  // served their time and still sick: they wait, nobody is let out unwell
  a.served = L.serve;
  steps(w, 5);
  assert.equal(a.state, "home");
  assert.equal(w.released, 0);
});

test("a guard walks them to the nurse, they get better, and go back to the bed they kept", () => {
  const w = jail({ people: 1 });
  until(w, () => sick(w).length === 1, 2, "someone sick");
  const a = sick(w)[0], { house, slot } = a;
  w.sickIn = 1e9;
  hire(w, "escort");
  until(w, () => a.state === "use" && a.station === "hospital", 40, "in a nurse's bed");
  until(w, () => a.state === "home", 40, "home again");
  assert.equal(a.sick, undefined);
  assert.equal(a.hurt, 0);
  assert.deepEqual([a.house, a.slot], [house, slot]);
});

test("never more sick at once than there are open beds, so nobody waits forever", () => {
  const w = jail({ people: 4, bought: ["hospital"] });
  for (let i = 0; i < 400 / DT; i++) {
    step(w, LEVELS, STILL);
    assert.ok(sick(w).length <= 2);
  }
  assert.equal(sick(w).length, 2);
});

test("a save keeps who is sick; an old save has nobody sick; sick with no nurse is only a bump", () => {
  const w = jail();
  until(w, () => sick(w).length > 0, 2, "someone sick");
  const name = sick(w)[0].sick;
  const back = restore(JSON.stringify(w), LEVELS);
  assert.equal(sick(back)[0].sick, name);

  const old = JSON.parse(JSON.stringify(jail()));
  delete old.sickIn;
  const was = restore(JSON.stringify(old), LEVELS);
  assert.equal(was.sickIn, L.sick.every);
  assert.equal(sick(was).length, 0);

  const raw = JSON.parse(JSON.stringify(w));
  raw.bought = raw.bought.filter((b) => b !== "hospital");
  const shut = restore(JSON.stringify(raw), LEVELS);
  assert.equal(sick(shut).length, 0);
  assert.ok(residents(shut).some((a) => a.hurt > 0), "they still rest it off at home");

  const odd = JSON.parse(JSON.stringify(w));
  odd.agents.find((a) => a.sick).sick = "dragon pox";
  assert.equal(sick(restore(JSON.stringify(odd), LEVELS)).length, 0);
});

test("the logo is you, then one of each kind you hire, and the nurse once the office is open", () => {
  const w = jail({ bought: [], people: 0 });
  assert.deepEqual(crewOf(w, L), ["player"]);
  hire(w, "escort");
  hire(w, "escort");
  hire(w, "carrier");
  assert.deepEqual(crewOf(w, L), ["player", "carrier", "escort"]);
  w.bought.push("hospital");
  assert.deepEqual(crewOf(w, L), ["player", "carrier", "escort", "nurse"]);
  const mark = crewMark(crewOf(w, L));
  for (const k of ["player", "carrier", "escort", "nurse"]) assert.ok(mark.includes(`data-crew="${k}"`), k);
  assert.ok(!mark.includes(`data-crew="clerk"`));
  assert.ok(crewMark(CREW).length > mark.length);
});

test("the home screen icon has the whole crew", () => {
  const icon = crewIcon();
  for (const k of CREW) assert.equal(icon.split(`data-crew="${k}"`).length, 2, k);
});
