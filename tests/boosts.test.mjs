import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { create, step, route, player, followers, boostChoices, boostMult, pickBoost, restore, DT } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";

// the three surprises on the floor: skates, a unicorn to ride, and a fairy who cleans
const L = LEVELS[0];
const K = L.boost.kinds;
const station = (id) => L.stations.find((s) => s.id === id);
const desk = station("desk");
const HALL = { x: 330, y: 540 };
const STILL = { x: 0, y: 0 };

function go(w, to, cap = 60 * 40) {
  const p = player(w);
  const path = route(w, L, p, to);
  for (let i = 0; i < cap; i++) {
    if (!path.length) return;
    const t = path[0], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
    if (d < 1) {
      path.shift();
      continue;
    }
    const s = w.speed * boostMult(w, L) * DT;
    step(w, LEVELS, d < s ? { x: dx / s, y: dy / s } : { x: dx / d, y: dy / d });
  }
  assert.fail(`never reached ${to.x},${to.y}`);
}
const wait = (w, seconds, levels = LEVELS) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) step(w, levels, STILL);
};
const until = (w, done, seconds, what, levels = LEVELS) => {
  for (let i = 0; i < seconds * 60; i++) {
    if (done()) return;
    step(w, levels, STILL);
  }
  assert.fail(`waited ${seconds}s for ${what}`);
};
const inmates = (w) => w.agents.filter((a) => a.kind === "agent");
const count = (w, state) => inmates(w).filter((a) => a.state === state).length;

/** the first busload in cells 1 and 2, full up and at home */
function settle(seed = 7) {
  const w = create(LEVELS, 0, seed);
  until(w, () => count(w, "queue") === 3 && inmates(w).every((a) => a.state !== "arrive"), 20, "the first bus to queue up");
  go(w, desk.at);
  until(w, () => count(w, "ready") === 3, 5, "three check-ins");
  go(w, desk.out[1]);
  go(w, station("c0").at);
  wait(w, 1);
  go(w, desk.out[2]);
  go(w, station("c1").at);
  wait(w, 0.6);
  const first = inmates(w).filter((a) => a.house);
  for (const b of first) for (const n of L.needs) b.needs[n.id] = 1;
  go(w, station("c0").at);
  go(w, station("c1").at);
  go(w, HALL);
  until(w, () => first.every((b) => b.state === "home"), 15, "everyone in bed");
  return { w, first };
}

/** a mess at a seat of a station, where the station would leave it */
function mess(w, id, seat) {
  const st = station(id), at = st.seats[seat].messAt ?? st.seats[seat].at;
  const m = { id: w.nextId++, kind: id === "showers" ? "puddle" : "poop", x: at.x, y: at.y, station: id, seat, clean: 0 };
  w.messes.push(m);
  return m;
}
/** a boost of this kind dropped right where the player stands, and one step to pick it up */
function drop(w, kind) {
  const p = player(w);
  w.boost = { x: p.x, y: p.y, here: true, t: 0 };
  w.boostKind = kind;
  step(w, LEVELS, STILL);
}
/** step until the fairy is done, noting the order the messes go in */
function watchFairy(w, seconds = 30, levels = LEVELS) {
  const gone = [];
  for (let i = 0; i < seconds * 60 && w.fairy.target !== null; i++) {
    const had = w.messes.map((m) => m.id);
    step(w, levels, STILL);
    for (const id of had) if (!w.messes.some((m) => m.id === id)) gone.push(id);
  }
  assert.equal(w.fairy.target, null, "the fairy is done");
  return gone;
}

test("the pick: exact weight edges, skates 50, unicorn 30, fairy 20, in that order", () => {
  const all = [["skates", 50], ["unicorn", 30], ["fairy", 20]];
  assert.equal(pickBoost(0, all), "skates");
  assert.equal(pickBoost(0.4999, all), "skates");
  assert.equal(pickBoost(0.5, all), "unicorn");
  assert.equal(pickBoost(0.7999, all), "unicorn");
  assert.equal(pickBoost(0.8, all), "fairy");
  assert.equal(pickBoost(0.9999, all), "fairy");
  // no fairy: the rest share the whole roll, skates 50 of 80
  const two = [["skates", 50], ["unicorn", 30]];
  assert.equal(pickBoost(0.6249, two), "skates");
  assert.equal(pickBoost(0.625, two), "unicorn");
  assert.equal(pickBoost(0.9999, two), "unicorn");
});

test("the fairy can turn up only while there is a mess, and the level's weights are the ones picked from", () => {
  const w = create(LEVELS, 0, 1);
  assert.deepEqual(boostChoices(w, L), [["skates", 50], ["unicorn", 30]]);
  mess(w, "showers", 0);
  assert.deepEqual(boostChoices(w, L), [["skates", 50], ["unicorn", 30], ["fairy", 20]]);
  // and in play: a boost that turns up on a clean floor is never a fairy; with a mess, now and then it is
  const seen = { clean: new Set(), messy: new Set() };
  for (let seed = 1; seed <= 120; seed++)
    for (const messy of [false, true]) {
      const v = create(LEVELS, 0, seed);
      if (messy) mess(v, "showers", 0);
      v.boost.t = 0;
      step(v, LEVELS, STILL);
      assert.ok(v.boost.here);
      seen[messy ? "messy" : "clean"].add(v.boostKind);
    }
  assert.deepEqual([...seen.clean].sort(), ["skates", "unicorn"]);
  assert.deepEqual([...seen.messy].sort(), ["fairy", "skates", "unicorn"]);
});

test("the unicorn: a longer, faster ride than the skates", () => {
  for (const kind of ["skates", "unicorn"]) {
    const w = create(LEVELS, 0, 3), p = player(w);
    drop(w, kind);
    assert.equal(w.mountKind, kind);
    assert.ok(w.boosted === K[kind].time, `${kind} lasts ${K[kind].time}s`);
    const x = p.x;
    step(w, LEVELS, { x: 1, y: 0 });
    assert.ok(Math.abs(p.x - x - w.speed * K[kind].mult * DT) < 1e-6, `${kind} step ${p.x - x}`);
    wait(w, K[kind].time);
    assert.equal(w.boosted, 0);
    const back = p.x;
    step(w, LEVELS, { x: 1, y: 0 });
    assert.ok(Math.abs(p.x - back - w.speed * DT) < 1e-6, "back to a walk");
  }
  assert.equal(K.unicorn.time, 15);
  assert.equal(K.unicorn.mult, 2.6);
  assert.equal(K.skates.time, 12);
  assert.equal(K.skates.mult, 2.2);
});

test("a follower keeps up at the speed of what the leader rides", () => {
  for (const [kind, boosted] of [["unicorn", 5], ["skates", 5], ["unicorn", 0]]) {
    const w = create(LEVELS, 0, 3), p = player(w);
    w.mountKind = kind;
    w.boosted = boosted;
    // one in line, well behind: it closes the gap at full follow speed
    const b = { ...structuredClone(p), id: 99, kind: "agent", state: "follow", leader: p.id, t: 0, x: p.x - 150, needs: { food: 1, wash: 1, toilet: 1 } };
    w.agents.push(b);
    assert.deepEqual(followers(w, p).map((a) => a.id), [99]);
    const x = b.x;
    step(w, LEVELS, STILL);
    const mult = boosted > 0 ? K[kind].mult : 1;
    assert.ok(Math.abs(b.x - x - w.speed * mult * 1.15 * DT) < 1e-6, `${kind} ${boosted}: moved ${b.x - x}`);
  }
});

test("the fairy cleans the messes nearest first, one visit each, and the seats are free again", () => {
  const { w, first } = settle();
  w.messes = [];
  const owner = first.find((b) => b.house === "c0");
  const puddle = mess(w, "showers", 0), c1 = mess(w, "toilets", 1), c0 = mess(w, "toilets", 0);
  for (const n of L.needs) owner.needs[n.id] = 1;
  owner.needs.toilet = 0.1;
  wait(w, 2);
  assert.notEqual(owner.station, "toilets", "the toilet is blocked by its mess");
  assert.ok(Math.hypot(player(w).x - HALL.x, player(w).y - HALL.y) < 1, "the player in the hall");
  drop(w, "fairy");
  assert.equal(w.boosted, 0, "she is not a ride");
  assert.equal(w.fairy.target, puddle.id, "the nearest first");
  const gone = watchFairy(w);
  // from the hall: the shower puddle, then the second cell, then the first
  assert.deepEqual(gone.filter((id) => [puddle.id, c1.id, c0.id].includes(id)), [puddle.id, c1.id, c0.id]);
  assert.equal(w.fairy.visits, 3);
  until(w, () => owner.station === "toilets", 5, "the toilet in use again");
});

test("about a visit each: the fairy takes the visit time to reach and clean a mess", () => {
  const w = create(LEVELS, 0, 3);
  const m = mess(w, "showers", 0);
  drop(w, "fairy");
  let steps = 1;
  while (w.messes.includes(m) && steps < 600) {
    step(w, LEVELS, STILL);
    steps++;
  }
  assert.ok(Math.abs(steps * DT - K.fairy.visit) <= 2 * DT, `${steps} steps`);
});

test("a full batch of eleven, every toilet and shower, is cleaned completely", () => {
  const w = create(LEVELS, 0, 3);
  const ids = [
    ...Array.from({ length: 8 }, (_, i) => mess(w, "toilets", i).id),
    ...[0, 1, 2].map((i) => mess(w, "showers", i).id),
  ];
  assert.equal(ids.length, 11);
  drop(w, "fairy");
  const gone = watchFairy(w);
  assert.deepEqual([...gone].sort((a, b) => a - b), ids);
  assert.equal(w.fairy.visits, 11);
  assert.deepEqual(w.messes, []);
});

test("a mess made after the fairy came is not hers: she finishes her own and is gone", () => {
  const w = create(LEVELS, 0, 3);
  const a = mess(w, "showers", 0), b = mess(w, "showers", 1);
  drop(w, "fairy");
  const late = mess(w, "toilets", 3);
  // and more still, while she flies
  let more = 0;
  for (let i = 0; i < 60 * 10 && w.fairy.target !== null; i++) {
    step(w, LEVELS, STILL);
    if (i % 20 === 0 && more < 10) mess(w, "toilets", more++ % 8);
  }
  assert.equal(w.fairy.target, null, "done, though new messes kept coming");
  assert.equal(w.fairy.visits, 2);
  assert.ok(!w.messes.includes(a) && !w.messes.includes(b));
  assert.ok(w.messes.includes(late), "the late one is still there");
  assert.equal(w.messes.length, 1 + more);
});

test("a mess cleaned by someone else on her way is skipped for the next on her list, or she is done", () => {
  // the player stands on the one she is flying to and cleans it first
  const w = create(LEVELS, 0, 3), p = player(w);
  const under = { id: w.nextId++, kind: "puddle", x: p.x, y: p.y, station: "showers", seat: 0, clean: 0 };
  w.messes.push(under);
  const far = mess(w, "showers", 1);
  drop(w, "fairy");
  assert.equal(w.fairy.target, under.id);
  until(w, () => !w.messes.includes(under), 1, "the player to clean it");
  assert.equal(w.fairy.visits, 0, "not hers");
  step(w, LEVELS, STILL);
  assert.equal(w.fairy.target, far.id, "on to the next");
  watchFairy(w);
  assert.equal(w.fairy.visits, 1);
  assert.deepEqual(w.messes, []);

  // with nothing else on her list, she is done
  const v = create(LEVELS, 0, 3), q = player(v);
  const only = { id: v.nextId++, kind: "puddle", x: q.x, y: q.y, station: "showers", seat: 0, clean: 0 };
  v.messes.push(only);
  drop(v, "fairy");
  const late = mess(v, "showers", 2);
  until(v, () => v.fairy.target === null, 1, "the fairy to poof");
  assert.equal(v.fairy.visits, 0);
  assert.ok(v.messes.includes(late), "never a mess from after she came");
});

test("a fairy picked up once the floor is clean comes as skates", () => {
  // a real spawn on a messy floor that came up fairy
  let w;
  for (let seed = 1; seed < 200 && !w; seed++) {
    const v = create(LEVELS, 0, seed);
    mess(v, "showers", 0);
    v.boost.t = 0;
    step(v, LEVELS, STILL);
    if (v.boostKind === "fairy") w = v;
  }
  assert.ok(w, "a fairy turned up");
  w.messes = [];
  const p = player(w);
  p.x = w.boost.x;
  p.y = w.boost.y;
  step(w, LEVELS, STILL);
  assert.equal(w.boost.here, false);
  assert.equal(w.mountKind, "skates");
  assert.ok(w.boosted === K.skates.time);
  assert.equal(w.fairy.target, null);
});

test("an old save, from before the surprises, comes back whole with quiet defaults", () => {
  const raw = readFileSync(new URL("./fixtures/v0.1.21-save.json", import.meta.url), "utf8");
  const old = JSON.parse(raw);
  assert.equal(old.boostKind, undefined);
  const back = restore(raw, LEVELS);
  assert.equal(back.v, 3);
  assert.equal(back.coins, 37);
  assert.equal(back.rank, 3);
  assert.equal(back.rng, 321);
  assert.equal(back.boostKind, "skates");
  assert.equal(back.mountKind, "skates");
  assert.deepEqual(back.fairy, create(LEVELS, 0).fairy);
  assert.deepEqual(back.picked, { n: 0, kind: "skates" });
  // the pickup record is kept when good, and quiet when it is junk
  const w = create(LEVELS, 0, 3);
  assert.deepEqual(restore(JSON.stringify({ ...w, picked: { n: 4, kind: "fairy" } }), LEVELS).picked, { n: 4, kind: "fairy" });
  for (const picked of [null, {}, { n: -1, kind: "dragon" }, { n: "4", kind: 2 }, 7])
    assert.deepEqual(restore(JSON.stringify({ ...w, picked }), LEVELS).picked, { n: 0, kind: "skates" }, JSON.stringify(picked));
  // the same old save with the skates on: still skates, at skates speed
  const skating = restore(JSON.stringify({ ...old, boosted: 5 }), LEVELS);
  assert.equal(skating.mountKind, "skates");
  assert.equal(boostMult(skating, L), K.skates.mult);
  const p = player(skating), x = p.x;
  step(skating, LEVELS, { x: 1, y: 0 });
  assert.ok(Math.abs(p.x - x - skating.speed * K.skates.mult * DT) < 1e-6);
});

test("the ride in and out comes back as it was saved", () => {
  const w = create(LEVELS, 0, 3);
  for (const ride of [{ state: "in", x: 40, t: 0 }, { state: "out", x: 300, t: 0 }, { state: "away", x: -100, t: 2.5 }]) {
    const back = restore(JSON.stringify({ ...w, ride, boostKind: "unicorn", mountKind: "unicorn", boosted: 3 }), LEVELS);
    assert.deepEqual(back.ride, ride);
    assert.equal(back.boostKind, "unicorn");
    assert.equal(back.mountKind, "unicorn");
  }
});

test("null, partial or unknown surprise fields come back as the quiet default; the rest of the save is kept", () => {
  const w = create(LEVELS, 0, 3);
  w.coins = 123;
  w.rank = 4;
  const idle = create(LEVELS, 0).fairy;
  const cases = [
    [{ boostKind: null, mountKind: null, fairy: null }, idle],
    [{ boostKind: "dragon", mountKind: "fairy", fairy: { todo: [1] } }, idle],
    [{ boostKind: 7, mountKind: {}, fairy: "flying" }, idle],
    [{ fairy: { todo: [1], visits: 1, x: 3, y: 4, t: 0.2, target: "x" } }, idle],
    [{ fairy: { visits: 1, x: 3, y: 4, t: 0.2, target: 9 } }, { todo: [], visits: 1, x: 3, y: 4, t: 0.2, target: 9 }],
    [{ fairy: { todo: "lots", visits: 1, x: 3, y: 4, t: 0.2, target: 9 } }, { todo: [], visits: 1, x: 3, y: 4, t: 0.2, target: 9 }],
    [{ fairy: { todo: [5, "a", null, 6, Infinity], visits: 0, x: 3, y: 4, t: 0, target: null } }, { todo: [5, 6], visits: 0, x: 3, y: 4, t: 0, target: null }],
  ];
  for (const [fields, fairy] of cases) {
    const back = restore(JSON.stringify({ ...w, ...fields }), LEVELS);
    assert.ok(back, JSON.stringify(fields));
    assert.equal(back.coins, 123);
    assert.equal(back.rank, 4);
    assert.ok(["skates", "unicorn", "fairy"].includes(back.boostKind));
    assert.ok(["skates", "unicorn"].includes(back.mountKind));
    if (fields.boostKind !== undefined) assert.equal(back.boostKind, "skates");
    if (fields.mountKind !== undefined) assert.equal(back.mountKind, "skates");
    assert.deepEqual(back.fairy, fairy, JSON.stringify(fields));
  }
  // a missing field, the same
  const { boostKind, mountKind, fairy, ...bare } = w;
  const back = restore(JSON.stringify(bare), LEVELS);
  assert.equal(back.boostKind, "skates");
  assert.equal(back.mountKind, "skates");
  assert.deepEqual(back.fairy, idle);
});

test("a reload mid-flight: the fairy carries on with the rest of her list, and the same as if never saved", () => {
  const w = create(LEVELS, 0, 3);
  const ids = [mess(w, "showers", 0), mess(w, "toilets", 2), mess(w, "toilets", 5)].map((m) => m.id);
  drop(w, "fairy");
  until(w, () => w.fairy.visits === 1, 3, "a first visit");
  wait(w, 0.3);
  const late = mess(w, "showers", 2);
  const back = restore(JSON.stringify(w), LEVELS);
  assert.equal(back.fairy.visits, 1);
  assert.equal(back.fairy.todo.length + 1, 2, "one in flight, one still to go");
  watchFairy(back);
  watchFairy(w);
  assert.equal(back.fairy.visits, 3);
  assert.ok(ids.every((id) => !back.messes.some((m) => m.id === id)));
  assert.deepEqual(back.messes.map((m) => m.id), [late.id], "never the one from after she came");
  assert.deepEqual(back.messes, w.messes);
  assert.deepEqual(back.fairy, w.fairy);
});
