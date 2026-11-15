import { test } from "node:test";
import assert from "node:assert/strict";
import { create, step, player, restore, hint, isOpen, AGENT_SPEED, DT, UPSET } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";
import { inside, walls } from "../src/engine/geom.ts";

// riots: one incident model on w.alert. at rank 3 and up, three or more upset residents at home in the
// cell block gather at the corridor after a warning; standing there calms them, one gets a bump and
// rests it off at home for free. below rank 3, or with fewer upset, it is the old squabble
const L = LEVELS[0];
const R = L.riot;
const STILL = { x: 0, y: 0 };
const station = (id) => L.stations.find((s) => s.id === id);
const steps = (w, n) => {
  for (let i = 0; i < n; i++) step(w, LEVELS, STILL);
};
const wait = (w, seconds) => steps(w, Math.round(seconds / DT));
const reward = (w) => w.floor.filter((c) => c.house === "").length;
const byId = (w, id) => w.agents.find((a) => a.id === id);

/** a jail at a given rank with residents in their beds in cells c0 and c1, needs full so nobody
 * leaves for a service, and the given unrest each. the incident clock is due */
function jail({ rank = 3, unrest = [0.9, 0.9, 0.9, 0.9] } = {}) {
  const w = create(LEVELS, 0, 7);
  w.rank = rank;
  w.ride = { state: "away", x: -100, t: 1e9 };
  const homes = [["c0", 0], ["c0", 1], ["c1", 0], ["c1", 1], ["c2", 0], ["c2", 1]];
  // a third cell when there are more than four
  if (unrest.length > 4) w.bought.push("cell3");
  unrest.forEach((u, i) => {
    const [house, slot] = homes[i];
    const at = station(house).seats[slot].at;
    w.agents.push({
      id: w.nextId++, kind: "agent", x: at.x, y: at.y, face: 1, moving: false, walk: 0, look: 0, tags: ["uniform"],
      state: "home", leader: -1, house, slot, station: "", seat: -1,
      needs: Object.fromEntries(L.needs.map((n) => [n.id, 1])), unrest: u, served: 0, rest: 10, t: 0, carry: 0, cash: 0, path: [], trail: [],
    });
  });
  // the player out of the way, in the hall
  Object.assign(player(w), { x: 330, y: 540 });
  w.fightIn = 0;
  return w;
}
const residents = (w) => w.agents.filter((a) => a.kind === "agent");

test("riot config sits beside fights with the contract's starting picks", () => {
  assert.deepEqual(
    { rank: R.rank, min: R.min, max: R.max, warn: R.warn, hold: R.hold, calm: R.calm, bump: R.bump, at: R.at },
    { rank: 3, min: 3, max: 4, warn: 5, hold: 3, calm: 30, bump: 20, at: { x: 360, y: 210 } },
  );
});

test("below rank 3 an incident is still a squabble of two", () => {
  const w = jail({ rank: 2 });
  steps(w, 1);
  assert.ok(w.alert);
  assert.equal(w.alert.kind ?? "squabble", "squabble");
  assert.equal(w.alert.ids.length, 2);
});

test("with fewer than three upset it is a squabble, even at rank 3", () => {
  const w = jail({ unrest: [0.9, 0.9, 0.1, 0.1] });
  steps(w, 1);
  assert.ok(w.alert);
  assert.equal(w.alert.kind ?? "squabble", "squabble");
});

test("three at home, all upset, is a riot: the squabble's smallest jail does not apply", () => {
  assert.ok(L.fights.minPop > R.min, "the case only means something while squabbles need more");
  const w = jail({ unrest: [0.9, 0.9, 0.9] });
  steps(w, 1);
  assert.equal(w.alert?.kind, "riot");
  assert.equal(w.alert.ids.length, 3);
});

test("three at home with fewer than three upset is no incident at all, and the clock does not run", () => {
  const w = jail({ unrest: [0.9, 0.9, 0.1] });
  w.fightIn = 7;
  steps(w, 60);
  assert.equal(w.alert, null);
  assert.equal(w.fightIn, 7, "below the squabble's smallest jail, nothing counts down");
});

test("time the incident clock ran for a crowd of three stays run: no rewind when they calm, a fourth carries on from there", () => {
  const f = L.fights;
  const w = jail({ unrest: [0.9, 0.9, 0.9] });
  w.fightIn = 20;
  steps(w, 120);
  const burnt = 20 - 120 * DT * (f.every / f.crossEvery);
  assert.ok(Math.abs(w.fightIn - burnt) < 1e-9, `upset burn, ${w.fightIn}`);
  assert.equal(w.alert, null);
  for (const a of residents(w)) a.unrest = 0.1;
  steps(w, 60);
  assert.ok(Math.abs(w.fightIn - burnt) < 1e-9, "three calm: held where it was, not rewound");
  const four = jail({ unrest: [0.1, 0.1, 0.1, 0.1] }).agents.at(-1);
  w.agents.push({ ...four, id: w.nextId++ });
  steps(w, 1);
  assert.ok(Math.abs(w.fightIn - (burnt - DT)) < 1e-9, "a calm fourth: on at the ordinary rate from there");
  assert.equal(w.alert, null);
});

test("a clock left due by a crowd that calmed gives one squabble when a fourth comes, paid once, then the ordinary wait", () => {
  const f = L.fights;
  const w = jail({ unrest: [0.9, 0.9, 0.1] });
  w.fightIn = -0.5;
  steps(w, 30);
  assert.equal(w.alert, null, "three at home, two upset: nothing");
  const four = jail({ unrest: [0.1, 0.1, 0.1, 0.1] }).agents.at(-1);
  w.agents.push({ ...four, id: w.nextId++ });
  steps(w, 1);
  assert.equal(w.alert?.kind, "squabble");
  const settled = w.settled, coins = w.coins;
  Object.assign(player(w), { x: w.alert.x, y: w.alert.y + 20 });
  until(w, () => w.alert === null, f.settle + 1, "the squabble settled");
  assert.equal(w.settled, settled + 1);
  assert.ok(w.fightIn >= f.every * 0.7 - 1, `the ordinary wait after, not ${w.fightIn}`);
  Object.assign(player(w), { x: 330, y: 540 });
  steps(w, 120);
  assert.equal(w.alert, null, "no second incident off the same due clock");
  assert.equal(reward(w) + w.coins - coins, f.reward, "one reward");
});

test("rank 3 with three or more upset: a riot warning, at most four, lowest ids first", () => {
  const w = jail();
  steps(w, 1);
  assert.equal(w.alert?.kind, "riot");
  assert.ok(w.alert.warn > R.warn - 2 * DT && w.alert.warn <= R.warn, "the warning has just begun");
  const ids = residents(w).filter((a) => a.unrest >= UPSET).map((a) => a.id).sort((a, b) => a - b).slice(0, R.max);
  assert.deepEqual(w.alert.ids, ids);
  assert.deepEqual({ x: w.alert.x, y: w.alert.y }, R.at, "the marker points at the corridor anchor");
  assert.equal(reward(w), 0);
});

test("someone reserved by the warning is not sent to a service", () => {
  const w = jail();
  steps(w, 1);
  const a = byId(w, w.alert.ids[0]);
  a.needs.toilet = 0;
  steps(w, 30);
  assert.notEqual(a.state, "go");
  assert.notEqual(a.state, "use");
});

/** step for a while and check every one of `ids` each step: no further than a walk, and the centre
 * never inside a wall a resident cannot pass. each step is at most 1.4 across, so a wall (8 thick)
 * cannot be stepped over between two samples */
function walkClear(w, ids, seconds) {
  const was = new Map(ids.map((id) => [id, { x: byId(w, id).x, y: byId(w, id).y }]));
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    step(w, LEVELS, STILL);
    const ws = walls(L, (r) => isOpen(w, r.locked), true);
    for (const id of ids) {
      const a = byId(w, id), b = was.get(id);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= AGENT_SPEED * DT + 1e-6, `resident ${id} jumped`);
      const hit = ws.find((r) => inside(a, r));
      assert.ok(!hit, `resident ${id} at ${a.x.toFixed(1)},${a.y.toFixed(1)} inside a wall ${JSON.stringify(hit)}`);
      was.set(id, { x: a.x, y: a.y });
    }
  }
}

test("they walk out of bed to the anchor on routes, through doors, never jumping", () => {
  const w = jail();
  steps(w, 1);
  const ids = w.alert.ids;
  walkClear(w, ids, R.warn + 2);
  assert.equal(w.alert?.kind, "riot");
  assert.equal(w.alert.warn, 0, "active after the warning");
  for (const id of ids) assert.ok(Math.hypot(byId(w, id).x - R.at.x, byId(w, id).y - R.at.y) < 60, `resident ${id} gathered`);
});

test("calmed, they walk back to bed through doors, never jumping", () => {
  const w = jail();
  steps(w, 1);
  wait(w, R.warn + 0.1);
  const ids = [...w.alert.ids];
  Object.assign(player(w), { x: R.at.x, y: R.at.y + 20 });
  until(w, () => w.alert === null, R.hold + 1, "the riot calmed");
  walkClear(w, ids, 8);
  for (const id of ids) assert.equal(byId(w, id).state, "home", `resident ${id} home`);
});

test("a warning that loses its crowd is cancelled, pays nothing and sends them home", () => {
  const w = jail();
  steps(w, 1);
  const settled = w.settled;
  const [a, b, c] = w.alert.ids.map((id) => byId(w, id));
  // two taken by the player's line: claimed by another job, so no longer theirs
  for (const x of [a, b]) Object.assign(x, { state: "follow", leader: 1 });
  if (w.alert.ids.length === 4) Object.assign(byId(w, w.alert.ids[3]), { state: "follow", leader: 1 });
  wait(w, R.warn + 0.5);
  assert.equal(w.alert, null);
  assert.equal(w.settled, settled);
  assert.equal(reward(w), 0);
  assert.ok(["back", "home"].includes(c.state), `the one left goes home, not ${c.state}`);
  assert.equal(c.house, "c1");
});

test("standing at the anchor for the hold calms an active riot, pays once, removes the alert in the same step", () => {
  const w = jail();
  steps(w, 1);
  wait(w, R.warn + 0.1);
  assert.equal(w.alert?.warn, 0);
  Object.assign(player(w), { x: R.at.x, y: R.at.y + 20 });
  const settled = w.settled, coins = w.coins;
  let seen = 0;
  for (let i = 0; i < Math.round((R.hold + 1) / DT); i++) {
    step(w, LEVELS, STILL);
    if (w.alert === null && !seen) {
      seen = 1;
      assert.equal(w.settled, settled + 1, "settled in the same step the alert goes");
      assert.equal(reward(w), L.fights.reward, "the reward in the same step");
    }
  }
  assert.equal(seen, 1, "calmed within the hold");
  assert.equal(w.settled, settled + 1, "and only once");
  // standing there, some of it is already in the pocket
  assert.equal(reward(w) + w.coins - coins, L.fights.reward, "paid once");
});

test("the hold is contiguous: stepping away starts it over", () => {
  const w = jail();
  steps(w, 1);
  wait(w, R.warn + 0.1);
  const p = player(w);
  Object.assign(p, { x: R.at.x, y: R.at.y + 20 });
  wait(w, R.hold - 1);
  Object.assign(p, { x: 330, y: 540 });
  steps(w, 2);
  Object.assign(p, { x: R.at.x, y: R.at.y + 20 });
  wait(w, R.hold - 1);
  assert.equal(w.alert?.kind, "riot", "two partial holds are not one");
});

test("after a riot: the lowest id gets a bump, unrest comes down to 0.3, nobody loses home or served", () => {
  const w = jail({ unrest: [0.9, 0.95, 0.7, 0.8] });
  steps(w, 1);
  const gathered = [...w.alert.ids];
  wait(w, R.warn + 0.1);
  // the one at 0.7 calmed below upset while they gathered, full up, so it went home before it began
  const ids = [...w.alert.ids];
  assert.equal(ids.length, gathered.length - 1);
  const before = new Map(ids.map((id) => [id, { house: byId(w, id).house, slot: byId(w, id).slot, served: byId(w, id).served }]));
  Object.assign(player(w), { x: R.at.x, y: R.at.y + 20 });
  wait(w, R.hold + 0.1);
  assert.equal(w.alert, null);
  const low = Math.min(...ids);
  for (const id of ids) {
    const a = byId(w, id), b = before.get(id);
    assert.equal(a.house, b.house);
    assert.equal(a.slot, b.slot);
    assert.ok(a.served >= b.served, "served never goes back");
    assert.ok(a.unrest <= 0.3 + 1e-9, `resident ${id} unrest ${a.unrest}`);
    if (id === low) assert.ok(a.hurt > R.bump - 1, "the bump");
    else assert.equal(a.hurt ?? 0, 0);
  }
});

test("a riot left a long while calms on its own unrest: calming never raises anyone to 0.3", () => {
  const w = jail();
  steps(w, 1);
  wait(w, R.warn + 20);
  const ids = [...w.alert.ids], was = new Map(ids.map((id) => [id, byId(w, id).unrest]));
  assert.ok([...was.values()].every((u) => u < 0.3), "full up, they cooled while nobody came");
  Object.assign(player(w), { x: R.at.x, y: R.at.y + 20 });
  until(w, () => w.alert === null, R.hold + 1, "the riot calmed");
  for (const id of ids) assert.ok(byId(w, id).unrest <= was.get(id) + 1e-9, `resident ${id} raised`);
});

test("a bump rests off at home for free: no hospital, needs paused, served still counting", () => {
  const w = jail();
  steps(w, 1);
  wait(w, R.warn + 0.1);
  Object.assign(player(w), { x: R.at.x, y: R.at.y + 20 });
  wait(w, R.hold + 0.1);
  Object.assign(player(w), { x: 330, y: 540 });
  const a = byId(w, Math.min(...residents(w).map((r) => r.id)));
  assert.ok(!w.bought.includes("hospital"));
  until(w, () => a.state === "home", 20, "the bumped one home");
  const needs = { ...a.needs }, served = a.served, hurt = a.hurt;
  wait(w, 5);
  assert.ok(Math.abs(a.hurt - (hurt - 5)) < 0.05, `recovery falls one a second, ${hurt} to ${a.hurt}`);
  assert.deepEqual(a.needs, needs, "needs wait while resting");
  assert.ok(a.served > served + 4.9, "served goes on");
  wait(w, R.bump);
  assert.equal(a.hurt, 0);
});

test("a bumped resident resting at home is in no incident and not let out until it is well", () => {
  // five, so four are still about with one resting
  const w = jail({ unrest: [0.9, 0.9, 0.9, 0.9, 0.1] });
  steps(w, 1);
  wait(w, R.warn + 0.1);
  Object.assign(player(w), { x: R.at.x, y: R.at.y + 20 });
  until(w, () => w.alert === null, R.hold + 1, "the riot calmed");
  Object.assign(player(w), { x: 330, y: 540 });
  const a = byId(w, Math.min(...residents(w).map((r) => r.id)));
  until(w, () => residents(w).every((r) => r.state === "home"), 20, "everyone home");
  assert.ok(a.hurt > 0, "still resting");
  // done with time, and lowest id: first in anything that takes residents by id
  a.served = L.serve;
  assert.notEqual(hint(w, L).key, "done", "nobody is told to let a resting one out");
  w.riotCalm = 0;
  for (const r of residents(w)) r.unrest = 0.9;
  w.fightIn = 0;
  steps(w, 1);
  assert.equal(w.alert?.kind, "riot");
  assert.ok(!w.alert.ids.includes(a.id), "without the one resting");
});

test("standing there through the warning does not calm it early: the hold starts once it is on", () => {
  const w = jail();
  Object.assign(player(w), { x: R.at.x, y: R.at.y + 20 });
  steps(w, 1);
  wait(w, R.warn - 0.2);
  assert.equal(w.alert?.kind, "riot");
  assert.equal(w.alert.held, 0, "nothing held while they gather");
  wait(w, 0.2 + R.hold - 0.3);
  assert.equal(w.alert?.kind, "riot", "not calmed before a full hold after it began");
  wait(w, 0.5);
  assert.equal(w.alert, null);
  assert.equal(w.settled, 1);
});

/** a jail just after a riot was calmed, everyone home again, the player in the hall */
function afterRiot() {
  const w = jail();
  steps(w, 1);
  wait(w, R.warn + 0.1);
  Object.assign(player(w), { x: R.at.x, y: R.at.y + 20 });
  until(w, () => w.alert === null, R.hold + 1, "the riot calmed");
  Object.assign(player(w), { x: 330, y: 540 });
  return w;
}

test("after a riot the next incident waits the ordinary time, and riots wait 30 seconds on their own", () => {
  const w = afterRiot();
  const f = L.fights;
  assert.ok(w.fightIn >= f.every * 0.7 && w.fightIn <= f.every * 1.3, `ordinary wait, not ${w.fightIn}`);
  assert.equal(w.riotCalm, R.calm);
});

test("the riot wait is simulation seconds, not sped up by anyone upset, and a squabble can still come in it", () => {
  const w = afterRiot();
  until(w, () => residents(w).every((a) => a.state === "home"), 20, "everyone home");
  const left = w.riotCalm;
  // everyone upset: the incident clock runs fast, the riot wait does not
  for (const a of residents(w)) a.unrest = 0.9;
  wait(w, 5);
  assert.ok(Math.abs(w.riotCalm - (left - 5)) < 0.05, `${left} less 5 is not ${w.riotCalm}`);
  // all four well again, so there are enough at home for an incident at all
  for (const a of residents(w)) a.hurt = 0;
  w.fightIn = 0;
  steps(w, 1);
  assert.equal(w.alert?.kind, "squabble", "inside the wait, a due incident is a squabble");
});

test("once the riot wait is over, a due incident with a crowd is a riot again", () => {
  const w = afterRiot();
  until(w, () => residents(w).every((a) => a.state === "home"), 20, "everyone home");
  wait(w, R.calm);
  assert.equal(w.riotCalm, 0);
  for (const a of residents(w)) a.unrest = 0.9;
  // the bumped one sat out, three well and upset is still a crowd
  w.fightIn = 0;
  for (const a of residents(w)) a.hurt = 0;
  steps(w, 1);
  assert.equal(w.alert?.kind, "riot");
});

test("a saved rioter or squabbler no alert names goes home when it has one, or back to the desk for a bed when it has none, and the jail runs on", () => {
  for (const state of ["riot", "fight"]) {
    const w = jail({ rank: 2, unrest: [0.1, 0.1] });
    const raw = JSON.parse(JSON.stringify(w));
    raw.alert = null;
    const base = raw.agents.find((a) => a.kind === "agent");
    const loose = [
      { ...base, id: 50, state, house: "c0", slot: 0 },
      { ...base, id: 51, state, house: "missing", slot: 0 },
      { ...base, id: 52, state, house: "c1", slot: 7 },
      { ...base, id: 53, state, house: "", slot: -1 },
    ];
    raw.agents = [raw.agents[0], ...loose.map((a) => ({ ...a, served: 30 }))];
    const back = restore(JSON.stringify(raw), LEVELS);
    assert.ok(back, `${state}: the save loads`);
    const got = (id) => back.agents.find((a) => a.id === id);
    assert.ok(["back", "home"].includes(got(50).state), `${state}: a real home is walked back to`);
    assert.equal(got(50).house, "c0");
    for (const id of [51, 52, 53]) {
      assert.equal(got(id).state, "ready", `${state} ${id}: back to the desk for a bed`);
      assert.equal(got(id).house, "");
      assert.equal(got(id).served, 30, "time served kept");
    }
    // well past the coin cadence and a squabble's worth of time: nothing throws, nothing is paid
    wait(back, Math.max(L.coinEvery * 3, 20));
    assert.equal(reward(back), 0);
    for (const id of [50, 51, 52, 53]) assert.ok(got(id), `${state} ${id}: still here`);
  }
});

/** a save as the game wrote it before riots: no kind or warning on the alert, nobody hurt, no riot wait */
function oldSave(w) {
  const raw = JSON.parse(JSON.stringify(w));
  if (raw.alert) {
    delete raw.alert.kind;
    delete raw.alert.warn;
  }
  delete raw.riotCalm;
  for (const a of raw.agents) delete a.hurt;
  return raw;
}

test("old saves: a squabble from before riots comes back as that squabble, everyone well", () => {
  const w = jail({ rank: 2 });
  steps(w, 1);
  w.alert.held = 0.4;
  const ids = [...w.alert.ids];
  const back = restore(JSON.stringify(oldSave(w)), LEVELS);
  assert.deepEqual(back.alert, { kind: "squabble", x: w.alert.x, y: w.alert.y, ids, held: 0.4, warn: 0 });
  assert.equal(back.riotCalm, 0);
  for (const a of back.agents) assert.equal(a.hurt, 0);
  for (const id of ids) assert.equal(back.agents.find((a) => a.id === id).state, "fight");
});

test("old saves: a squabble naming nobody who is squabbling is dropped, and its fighters go home", () => {
  const w = jail({ rank: 2 });
  steps(w, 1);
  const fighters = [...w.alert.ids];
  const empty = oldSave(w);
  empty.alert.ids = [];
  let back = restore(JSON.stringify(empty), LEVELS);
  assert.equal(back.alert, null);
  for (const id of fighters) assert.ok(["back", "home"].includes(back.agents.find((a) => a.id === id).state), "not left squabbling with no squabble");
  const gone = oldSave(w);
  gone.alert.ids = [900, 901];
  back = restore(JSON.stringify(gone), LEVELS);
  assert.equal(back.alert, null);
  steps(back, 2);
  assert.equal(reward(back), 0, "nothing paid for it");
});

test("a riot warning survives a reload with its time and crowd", () => {
  const w = jail();
  steps(w, 1);
  wait(w, 2);
  const warn = w.alert.warn, ids = [...w.alert.ids];
  const back = restore(JSON.stringify(w), LEVELS);
  assert.equal(back.alert.kind, "riot");
  assert.ok(Math.abs(back.alert.warn - warn) < 1e-9);
  assert.deepEqual(back.alert.ids, ids);
});

test("a saved riot that names someone gone is dropped safely, nobody paid, homes kept", () => {
  const w = jail();
  steps(w, 1);
  const raw = JSON.parse(JSON.stringify(w));
  raw.agents = raw.agents.filter((a) => a.id !== raw.alert.ids[0] && a.id !== raw.alert.ids[1]);
  const back = restore(JSON.stringify(raw), LEVELS);
  steps(back, 2);
  assert.ok(back.alert === null || back.alert.ids.every((id) => back.agents.some((a) => a.id === id)));
  assert.equal(reward(back), 0);
  for (const a of back.agents.filter((a) => a.kind === "agent")) assert.ok(a.house, "still housed");
});

const until = (w, done, seconds, what) => {
  for (let i = 0; i < seconds / DT; i++) {
    if (done()) return;
    step(w, LEVELS, STILL);
  }
  assert.fail(`waited ${seconds}s for ${what}`);
};
