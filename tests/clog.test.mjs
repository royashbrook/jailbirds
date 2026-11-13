import { test } from "node:test";
import assert from "node:assert/strict";
import {
  create, step, route, player, followers, boostMult, boostChoices, budget, dirtSpots, hint, mood, restore, wants,
  CLEAN_TIME, DIRT_MAX, DT, SEEP, UPSET, U_CALM, U_DIRT, U_NEED,
} from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";
import { actionOf, dirtStage, poseMood } from "../src/view/view.ts";
import { model } from "../src/skins/pegs.ts";

// clogging toilets and unrest (#34, slice one): one bounded dirt state per toilet, at the toilet,
// seeping while clogged, cleaned a level at a time, the fairy's finite budget, old saves brought
// over without loss, and unrest with its one mood judge
const L = LEVELS[0];
const K = L.boost.kinds;
const station = (id) => L.stations.find((s) => s.id === id);
const desk = station("desk");
const T = station("toilets");
const HALL = { x: 330, y: 540 };
const STILL = { x: 0, y: 0 };
const key = (i) => `toilets:${i}`;
const spot = (i) => T.seats[i].messAt;
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is not ${b}`);

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
const wait = (w, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) step(w, LEVELS, STILL);
};
const until = (w, done, seconds, what) => {
  for (let i = 0; i < seconds * 60; i++) {
    if (done()) return;
    step(w, LEVELS, STILL);
  }
  assert.fail(`waited ${seconds}s for ${what}`);
};
const inmates = (w) => w.agents.filter((a) => a.kind === "agent");
const count = (w, state) => inmates(w).filter((a) => a.state === state).length;
function toCell(w, id) {
  const at = station(id).at;
  go(w, { x: at.x, y: at.y + 46 });
  go(w, at);
}
/** the first busload: two in cell 1, one in cell 2, full up and at home */
function settle(seed = 7) {
  const w = create(LEVELS, 0, seed);
  until(w, () => count(w, "queue") === 3 && inmates(w).every((a) => a.state !== "arrive"), 20, "the first bus to queue up");
  go(w, desk.at);
  until(w, () => count(w, "ready") === 3, 5, "three check-ins");
  go(w, desk.out[1]);
  until(w, () => followers(w, player(w)).length === 2, 2, "two to join");
  toCell(w, "c0");
  wait(w, 1);
  go(w, desk.out[2]);
  until(w, () => followers(w, player(w)).length === 1, 1, "the third to join");
  go(w, station("c1").at);
  wait(w, 0.6);
  const first = inmates(w).filter((a) => a.house);
  for (const b of first) for (const n of L.needs) b.needs[n.id] = 1;
  go(w, station("c0").at);
  go(w, station("c1").at);
  go(w, HALL);
  until(w, () => first.every((b) => b.state === "home"), 15, "everyone in bed");
  // nothing left over from the walk round: full up, calm, every toilet clean
  for (const b of first) {
    for (const n of L.needs) b.needs[n.id] = 1;
    b.unrest = 0;
  }
  w.dirt = {};
  w.messes = [];
  return { w, first };
}
const stand = (w, at) => {
  const p = player(w);
  p.x = at.x;
  p.y = at.y;
};
const dirt = (w, i, level, clean = 0, removed = 0) => (w.dirt[key(i)] = { level, clean, removed });
function drop(w, kind) {
  const p = player(w);
  w.boost = { x: p.x, y: p.y, here: true, t: 0 };
  w.boostKind = kind;
  step(w, LEVELS, STILL);
}
function watchFairy(w, seconds = 30) {
  for (let i = 0; i < seconds * 60 && w.fairy.target !== null; i++) step(w, LEVELS, STILL);
  assert.equal(w.fairy.target, null, "the fairy is done");
}
/** dirt seeping in, sped up: it only ever raises the level, and never touches what was taken off */
const seepBy = (w, i, levels) => (w.dirt[key(i)].level += levels);
/** how much seeps in over this many seconds */
const seeped = (seconds) => seconds / SEEP;

// --- where the dirt is, and how it grows

test("every toilet seat, and nothing else, clogs; each is cleaned from just beside its toilet, inside its cell", () => {
  for (const l of LEVELS) {
    const toilets = l.stations.filter((s) => s.kind === "facility" && s.look === "toilet");
    assert.deepEqual(dirtSpots(l).map((s) => s.key), toilets.flatMap((s) => s.seats.map((_, i) => `${s.id}:${i}`)));
    assert.equal(dirtSpots(l).length, 8);
    dirtSpots(l).forEach((s, i) => {
      const seat = toilets[0].seats[i];
      assert.deepEqual(s.at, { x: seat.at.x - 12, y: seat.at.y + 16 }, s.key);
      assert.deepEqual(s.at, { x: 76 + 84 * i, y: 66 }, "the first at 76,66 and every 84 along");
      assert.equal(Math.hypot(s.at.x - seat.at.x, s.at.y - seat.at.y), 20, "a reach from the toilet");
      const r = l.rooms.find((x) => x.id === s.house).rect;
      assert.ok(s.at.x - 10 >= r.x && s.at.x + 10 <= r.x + r.w && s.at.y - 10 >= r.y && s.at.y + 10 <= r.y + r.h, `${s.key} a body inside ${s.house}`);
    });
    // the shower puddles stay where they were
    assert.deepEqual(l.stations.find((s) => s.id === "showers").seats.map((s) => s.messAt), [0, 1, 2].map((i) => ({ x: 545 + i * 60, y: 556 })));
  }
});

test("a toilet use clogs it one level, never a mess on the floor; it seeps to the most and stops there", () => {
  const { w, first } = settle();
  const b = first.find((x) => x.house === "c1");
  b.needs.toilet = 0.1;
  until(w, () => b.state === "use", 10, "a toilet visit");
  until(w, () => b.state !== "use", 5, "done");
  near(w.dirt[key(1)].level, 1, 2 * seeped(DT), "one level, from one use");
  assert.equal(w.dirt[key(1)].removed, 0);
  assert.ok(!w.messes.some((m) => m.station === "toilets"), "no floor mess");
  // clogged: the next time it is refused
  until(w, () => b.state === "home", 10, "home");
  b.needs.toilet = 0.1;
  wait(w, 2);
  assert.ok(b.state === "home" && b.station !== "toilets", "a clogged toilet is not used");
  // with nobody cleaning: up a level each SEEP seconds, up to the most, and never past it
  let top = 0;
  for (let i = 0; i < 60 * (3 * SEEP + 20); i++) {
    step(w, LEVELS, STILL);
    top = Math.max(top, w.dirt[key(1)].level);
  }
  assert.equal(w.dirt[key(1)].level, DIRT_MAX);
  assert.equal(top, DIRT_MAX, "never past the most");
});

test("a clean toilet never seeps; any dirt above clean seeps at the same rate, a fraction too, and only in steps", () => {
  const w = create(LEVELS, 0, 3);
  dirt(w, 0, 0);
  dirt(w, 1, 0.8);
  dirt(w, 2, 3.5);
  const saved = JSON.stringify(w);
  // nothing happens between steps: a save and a load later, it is all as it was
  assert.deepEqual(restore(saved, LEVELS).dirt, w.dirt);
  wait(w, 10);
  assert.deepEqual(w.dirt[key(0)], { level: 0, clean: 0, removed: 0 }, "clean stays clean");
  near(w.dirt[key(1)].level, 0.8 + seeped(10), 1e-9, "0.8 grows");
  near(w.dirt[key(2)].level, 3.5 + seeped(10), 1e-9, "3.5 grows");
  wait(w, 20);
  assert.equal(w.dirt[key(2)].level, DIRT_MAX, "and stops at the most");
  for (const i of [1, 2]) assert.equal(w.dirt[key(i)].removed, 0, "seeping never counts as taken off");
  assert.ok(!(key(3) in w.dirt), "a toilet that was never dirty has nothing to it");
});

// --- cleaning

test("standing at a toilet takes one level off per CLEAN_TIME, a remainder to exactly clean, and cleaning beats seeping", () => {
  const w = create(LEVELS, 0, 3);
  dirt(w, 0, DIRT_MAX);
  stand(w, spot(0));
  let steps = 0;
  until(w, () => (steps++, w.dirt[key(0)].removed > 0), 2, "a first layer");
  near((steps - 1) * DT, CLEAN_TIME, 1.5 * DT, "a layer a CLEAN_TIME");
  assert.equal(w.dirt[key(0)].removed, 1, "one level off");
  near(w.dirt[key(0)].level, DIRT_MAX - 1, 2 * seeped(DT), "and below the most, it seeps again");
  assert.equal(w.dirt[key(0)].clean, 0, "the clean that took it is spent");
  // the rest, though it keeps seeping while it is cleaned: what seeps in comes off too, to exactly 0
  until(w, () => w.dirt[key(0)].level === 0, 5 * CLEAN_TIME + 0.1, "a clean toilet");
  assert.ok(w.dirt[key(0)].removed > DIRT_MAX, "what seeped in while cleaning came off too");
  // four more cleans of seeping, give or take a step each
  near(w.dirt[key(0)].removed, DIRT_MAX + seeped(4 * CLEAN_TIME), 6 * seeped(DT), "every bit counted, no more");
  wait(w, 60);
  assert.equal(w.dirt[key(0)].level, 0, "clean, and it stays clean");

  // a fraction comes off in one go, to exactly 0, and counts as what it was, not a whole level
  const v = create(LEVELS, 0, 3);
  dirt(v, 1, 0.8);
  stand(v, spot(1));
  until(v, () => v.dirt[key(1)].level === 0, CLEAN_TIME + 0.1, "0.8 cleaned");
  assert.ok(v.dirt[key(1)].removed < 1, `took off ${v.dirt[key(1)].removed}, the dirt that was there`);
  near(v.dirt[key(1)].removed, 0.8 + seeped(CLEAN_TIME), 2 * seeped(DT), "0.8 and what seeped in meanwhile");
});

test("a clean under way is kept while the cleaner steps away, and is spent by the layer it finishes", () => {
  const w = create(LEVELS, 0, 3);
  dirt(w, 0, 3);
  stand(w, spot(0));
  wait(w, CLEAN_TIME / 2);
  const half = w.dirt[key(0)].clean;
  near(half, CLEAN_TIME / 2, DT, "half a clean");
  stand(w, HALL);
  wait(w, 2);
  assert.equal(w.dirt[key(0)].clean, half, "kept while away");
  assert.equal(w.dirt[key(0)].removed, 0, "half a clean takes nothing off");
  stand(w, spot(0));
  let steps = 0;
  until(w, () => (steps++, w.dirt[key(0)].removed > 0), 1, "the layer");
  near((steps - 1) * DT, CLEAN_TIME / 2, 1.5 * DT, "only the other half to go");
  assert.equal(w.dirt[key(0)].clean, 0);
});

test("a cleaner helper cleans clogged toilets, and the toilet is used again", () => {
  const { w, first } = settle();
  const b = first.find((x) => x.house === "c1");
  dirt(w, 1, 2.5);
  w.agents.push({ ...structuredClone(player(w)), id: w.nextId++, kind: "cleaner", x: L.helperHome.x, y: L.helperHome.y, trail: [], path: [] });
  b.needs.toilet = 0.1;
  until(w, () => w.dirt[key(1)].level === 0, 20, "the cleaner to clean it");
  until(w, () => b.station === "toilets", 5, "the toilet in use again");
});

test("a clogged toilet asks to be cleaned, and the fairy may come for it", () => {
  const w = create(LEVELS, 0, 3);
  assert.deepEqual(boostChoices(w, L).map(([k]) => k), ["skates", "unicorn"]);
  dirt(w, 0, 0.3);
  assert.deepEqual(boostChoices(w, L).map(([k]) => k), ["skates", "unicorn", "fairy"]);
  w.ride.t = 9999;
  assert.equal(hint(w, L).key, "clean");
});

// --- the fairy: what she captured, and only that

test("the fairy takes what was there when she came and leaves what seeped in after", () => {
  const w = create(LEVELS, 0, 3);
  dirt(w, 0, 2);
  drop(w, "fairy");
  assert.deepEqual(w.fairy.target, { key: key(0), amount: 2, removedAt: 0 });
  watchFairy(w);
  assert.equal(w.fairy.visits, 1);
  assert.equal(w.dirt[key(0)].removed, 2, "exactly what she captured");
  near(w.dirt[key(0)].level, seeped(K.fairy.visit), 2 * seeped(DT), "the seep since she came is left");

  // full up, nothing seeps: she takes it all, and a clean under way goes with it
  const v = create(LEVELS, 0, 3);
  dirt(v, 1, DIRT_MAX, 0.3);
  drop(v, "fairy");
  watchFairy(v);
  assert.deepEqual(v.dirt[key(1)], { level: 0, clean: 0, removed: DIRT_MAX });
});

test("counterexample: a partial clean by someone else, then seepage, before she lands: she takes her remaining two and leaves the new one", () => {
  const w = create(LEVELS, 0, 3);
  dirt(w, 0, 3);
  stand(w, spot(0));
  drop(w, "fairy");
  assert.deepEqual(w.fairy.target, { key: key(0), amount: 3, removedAt: 0 });
  // the player takes one level off while she flies, then walks away
  until(w, () => w.dirt[key(0)].removed === 1, 1, "the player's layer");
  stand(w, HALL);
  assert.equal(budget(w, w.fairy.target), 2, "her budget is what is left of what she captured");
  seepBy(w, 0, 1);
  const before = w.dirt[key(0)].level;
  assert.ok(before > 3, "back up past where she found it");
  watchFairy(w);
  assert.equal(w.dirt[key(0)].removed, 3, "the player's one and her two");
  assert.ok(w.dirt[key(0)].level > 1, `the new level stays: ${w.dirt[key(0)].level}`);
  near(w.dirt[key(0)].level, before - 2, 0.1, "she took two");
});

test("counterexample: cleaned to zero and clogged again before she lands: none of it is hers", () => {
  // she flies to a puddle by the hall first; the toilet is next on her list
  const w = create(LEVELS, 0, 3), p = player(w);
  dirt(w, 0, 0.5);
  const puddle = { id: w.nextId++, kind: "puddle", x: p.x + 30, y: p.y, station: "showers", seat: 0, clean: 0 };
  w.messes.push(puddle);
  drop(w, "fairy");
  assert.equal(w.fairy.target, puddle.id);
  assert.deepEqual(w.fairy.todo, [{ key: key(0), amount: 0.5, removedAt: 0 }]);
  // meanwhile the player cleans the toilet to nothing, and it clogs again: two uses' worth
  stand(w, spot(0));
  until(w, () => w.dirt[key(0)].level === 0, 1, "the player to clean it");
  stand(w, HALL);
  assert.equal(w.fairy.target, puddle.id, "still on her way to the puddle");
  const players = w.dirt[key(0)].removed;
  w.dirt[key(0)].level = 2;
  watchFairy(w);
  assert.equal(w.fairy.visits, 1, "the puddle; nothing of hers was left at the toilet");
  assert.equal(w.dirt[key(0)].removed, players, "only the player's");
  assert.ok(w.dirt[key(0)].level >= 2, "the new dirt stays");
});

test("a toilet clogged after she came is not hers, and the list ends", () => {
  const w = create(LEVELS, 0, 3);
  dirt(w, 0, 2);
  drop(w, "fairy");
  dirt(w, 1, 2);
  watchFairy(w);
  assert.equal(w.fairy.visits, 1);
  assert.equal(w.dirt[key(1)].removed, 0);
  assert.ok(w.dirt[key(1)].level >= 2);
});

test("fractions: her visit counts only dirt, never a clean under way, and keeps that clean on what she leaves", () => {
  const w = create(LEVELS, 0, 3);
  dirt(w, 0, 2);
  drop(w, "fairy");
  // the player cleans a quarter of a layer while she flies, then steps off
  stand(w, spot(0));
  wait(w, 0.25);
  stand(w, HALL);
  const part = w.dirt[key(0)].clean;
  near(part, 0.25, DT, "a clean under way");
  watchFairy(w);
  assert.equal(w.dirt[key(0)].removed, 2, "her two, and not a bit for the clean under way");
  assert.ok(w.dirt[key(0)].level > 0, "what seeped in since she came");
  assert.equal(w.dirt[key(0)].clean, part, "the clean under way on what she left is kept");
});

test("a reload mid-flight: she carries on with her captured seats the same as if never saved", () => {
  const w = create(LEVELS, 0, 3);
  dirt(w, 0, 2);
  dirt(w, 5, 1.5);
  const puddle = { id: w.nextId++, kind: "puddle", x: 545, y: 556, station: "showers", seat: 0, clean: 0 };
  w.messes.push(puddle);
  drop(w, "fairy");
  until(w, () => w.fairy.visits === 1, 3, "a first visit");
  wait(w, 0.3);
  const back = restore(JSON.stringify(w), LEVELS);
  assert.deepEqual(back.fairy, w.fairy);
  assert.deepEqual(back.dirt, w.dirt);
  assert.deepEqual(restore(JSON.stringify(back), LEVELS).fairy, back.fairy, "and again");
  watchFairy(back);
  watchFairy(w);
  assert.equal(back.fairy.visits, 3);
  assert.deepEqual(back.dirt, w.dirt);
  assert.deepEqual(back.messes, w.messes);
});

// --- old saves

/** a save from before toilets clogged: no dirt, no unrest, the toilet's dirt a poop on the floor */
function oldSave(over = {}) {
  const w = create(LEVELS, 0, 3);
  w.coins = 37;
  w.piles = { desk: 4, stamp: 10 };
  w.floor = [{ x: 100, y: 180, house: "c0" }];
  w.released = 3;
  w.settled = 2;
  w.rank = 2;
  w.took = { n: 5, floor: 6, rank: 20, piles: { desk: 8 } };
  const old = JSON.parse(JSON.stringify(w));
  delete old.dirt;
  for (const a of old.agents) delete a.unrest;
  return { ...old, ...over };
}
const poop = (id, seat, clean = 0) => ({ id, kind: "poop", x: 80 + seat * 84, y: 108, station: "toilets", seat, clean });
const wet = (id, seat) => ({ id, kind: "puddle", x: 545 + seat * 60, y: 556, station: "showers", seat, clean: 0 });

test("an old poop on a toilet becomes that toilet's first level, with its clean kept, once, and pays nothing", () => {
  const old = oldSave({ nextId: 60, messes: [poop(50, 3, 0.25), wet(51, 0)] });
  const back = restore(JSON.stringify(old), LEVELS);
  assert.deepEqual(back.dirt, { [key(3)]: { level: 1, clean: 0.25, removed: 0 } });
  assert.deepEqual(back.messes, [wet(51, 0)], "never both a mess and dirt; the puddle as it was");
  for (const k of ["coins", "piles", "floor", "released", "settled", "rank", "stars", "took", "nextId"]) assert.deepEqual(back[k], old[k], k);
  assert.ok(back.agents.every((a) => a.unrest === 0));
  // a second load of the same old save, or of the new one, is the same: nothing repeats
  assert.deepEqual(restore(JSON.stringify(old), LEVELS), back);
  assert.deepEqual(restore(JSON.stringify(back), LEVELS), back);
  // the clean it had got to counts: it takes the rest of a clean, not a whole one
  stand(back, spot(3));
  let steps = 0;
  until(back, () => (steps++, back.dirt[key(3)].removed > 0), 1, "cleaned");
  near((steps - 1) * DT, CLEAN_TIME - 0.25, 1.5 * DT, "the rest of the clean");
  assert.equal(back.coins, old.coins, "cleaning pays nothing");
  // a poop with a clean we cannot read starts from none, and one past the end is one step from done
  assert.equal(restore(JSON.stringify(oldSave({ messes: [poop(50, 3, "half")] })), LEVELS).dirt[key(3)].clean, 0);
  assert.equal(restore(JSON.stringify(oldSave({ messes: [poop(50, 3, 7)] })), LEVELS).dirt[key(3)].clean, CLEAN_TIME);
});

test("saved dirt comes back within its bounds; junk is clean, and only toilets have any", () => {
  const w = create(LEVELS, 0, 3);
  const saved = {
    [key(0)]: "lots",
    [key(1)]: { level: 9, clean: -2, removed: "a" },
    [key(2)]: { level: NaN, clean: 0.2, removed: 1 },
    [key(3)]: { level: 2.5, clean: 0.1, removed: 3 },
    [key(4)]: { level: 0, clean: 0.3, removed: 2 },
    [key(5)]: { level: -1, clean: 9, removed: -4 },
    "toilets:8": { level: 2 },
    "showers:0": { level: 2 },
    nope: null,
  };
  const back = restore(JSON.stringify({ ...w, dirt: saved }), LEVELS);
  assert.deepEqual(back.dirt, {
    [key(0)]: { level: 0, clean: 0, removed: 0 },
    [key(1)]: { level: DIRT_MAX, clean: 0, removed: 0 },
    [key(2)]: { level: 0, clean: 0, removed: 1 },
    [key(3)]: { level: 2.5, clean: 0.1, removed: 3 },
    [key(4)]: { level: 0, clean: 0, removed: 2 },
    [key(5)]: { level: 0, clean: 0, removed: 0 },
  });
  for (const junk of [null, "x", 7, []]) assert.deepEqual(restore(JSON.stringify({ ...w, dirt: junk }), LEVELS).dirt, {}, JSON.stringify(junk));
  // an old poop on a toilet that the save also has as dirty is not counted twice
  const both = restore(JSON.stringify({ ...w, dirt: { [key(3)]: { level: 2.5, clean: 0.1, removed: 3 } }, messes: [poop(50, 3, 0.3)] }), LEVELS);
  assert.deepEqual(both.dirt[key(3)], { level: 2.5, clean: 0.1, removed: 3 });
  assert.deepEqual(both.messes, []);
});

test("an old fairy in flight: her poop target and queued poop become the seats she owes one level, puddles and order kept, nothing new captured", () => {
  const fairy = { todo: [51, 99], visits: 2, x: 200, y: 300, target: 50, t: 0.3 };
  const old = oldSave({ nextId: 60, messes: [poop(50, 0, 0.1), wet(51, 0), poop(52, 1)], fairy });
  const back = restore(JSON.stringify(old), LEVELS);
  assert.deepEqual(back.fairy, { todo: [51, 99], visits: 2, x: 200, y: 300, target: { key: key(0), amount: 1, removedAt: 0 }, t: 0.3 });
  assert.deepEqual(back.dirt, { [key(0)]: { level: 1, clean: 0.1, removed: 0 }, [key(1)]: { level: 1, clean: 0, removed: 0 } });
  assert.deepEqual(back.messes, [wet(51, 0)]);
  const again = restore(JSON.stringify(back), LEVELS);
  assert.deepEqual(again, back, "a second load changes nothing");
  // she finishes what she had: the toilet she was flying to and the puddle; the id that is gone is
  // skipped, and the toilet she never captured is left
  watchFairy(back);
  watchFairy(again);
  assert.equal(back.fairy.visits, 4);
  assert.equal(back.dirt[key(0)].removed, 1, "her one level");
  assert.ok(back.dirt[key(0)].level < 0.1, "only what seeped in since is left");
  assert.equal(back.dirt[key(1)].removed, 0, "never captured, never hers");
  assert.ok(back.dirt[key(1)].level >= 1);
  assert.deepEqual(back.messes, []);
  assert.deepEqual(again, back, "and the same after as if loaded once");
  assert.equal(back.coins, old.coins);

  // her list keeps its order, each poop in its own place
  const order = restore(JSON.stringify(oldSave({ messes: [poop(50, 0), wet(51, 0), poop(52, 1)], fairy: { ...fairy, todo: [52, 99, 50], target: 51 } })), LEVELS);
  assert.deepEqual(order.fairy.todo, [{ key: key(1), amount: 1, removedAt: 0 }, 99, { key: key(0), amount: 1, removedAt: 0 }]);
  assert.equal(order.fairy.target, 51);
});

test("a saved fairy's seats come back sane: junk ones dropped, never owed more than she captured", () => {
  const w = create(LEVELS, 0, 3);
  dirt(w, 0, 2, 0, 1);
  const good = { key: key(0), amount: 2, removedAt: 1 };
  const fairy = (todo, target = good) => ({ todo, visits: 0, x: 1, y: 2, target, t: 0.1 });
  const back = (f) => restore(JSON.stringify({ ...w, fairy: f }), LEVELS).fairy;
  assert.deepEqual(back(fairy([good, 7])).todo, [good, 7]);
  const junk = [{ key: "showers:0", amount: 1, removedAt: 0 }, { key: key(1), amount: -1, removedAt: 0 }, { key: key(1), amount: 1 }, { amount: 1, removedAt: 0 }, "x", null];
  assert.deepEqual(back(fairy([...junk, good])).todo, [good]);
  assert.deepEqual(back(fairy([], { key: "nope", amount: 1, removedAt: 0 })), create(LEVELS, 0).fairy, "a target that cannot be read: at rest");
  // a seat claimed from later than anything was taken off is owed no more than she captured
  const f = back(fairy([], { key: key(0), amount: 2, removedAt: 5 }));
  assert.equal(f.target.removedAt, 1);
  assert.equal(budget(restore(JSON.stringify({ ...w, fairy: f }), LEVELS), f.target), 2);
});

// --- unrest and mood

test("mood, worst first: cross, then upset, then needy, then ok", () => {
  const a = (needs, unrest) => ({ kind: "agent", needs: { food: 1, wash: 1, toilet: 1, ...needs }, unrest });
  assert.equal(mood(L, a({}, 0)), "ok");
  assert.equal(mood(L, a({}, UPSET - 0.01)), "ok");
  assert.equal(mood(L, a({}, UPSET)), "upset");
  assert.equal(mood(L, a({ food: 0.2 }, 0)), "needy");
  assert.equal(mood(L, a({ food: 0.2 }, 0.7)), "upset", "upset over needy");
  assert.equal(mood(L, a({ food: 0 }, 1)), "cross", "cross over upset");
  assert.equal(mood(L, a({ food: 0 }, 0)), "cross");
  // the bubble still shows only what they want: unrest adds none
  assert.equal(wants(L, a({}, 1), true), null);
  assert.equal(wants(L, a({ wash: 0.2 }, 1), true), "wash");
});

test("unrest builds for each low need and a dirty toilet at home, falls while neither, and stays from 0 to 1", () => {
  const { w, first } = settle();
  const [x, y] = first.filter((b) => b.house === "c0"), z = first.find((b) => b.house === "c1");
  // all well: nothing
  wait(w, 3);
  assert.ok(first.every((b) => b.unrest === 0));
  // one need low, two needs low
  x.needs.food = 0.2;
  y.needs.food = 0.2;
  y.needs.wash = 0.2;
  wait(w, 3);
  near(x.unrest, 3 * U_NEED, 2 * DT * U_NEED, "one low need");
  near(y.unrest, 3 * 2 * U_NEED, 4 * DT * U_NEED, "two low needs");
  assert.equal(z.unrest, 0);
  // a dirty toilet at home counts from DIRT_UNREST on; someone else's never does
  dirt(w, 1, 2);
  dirt(w, 0, 3.5);
  x.needs.food = y.needs.food = y.needs.wash = 1;
  x.unrest = y.unrest = 0;
  wait(w, 3);
  near(z.unrest, 3 * U_DIRT, 2 * DT * U_DIRT, "a dirty toilet at home");
  near(x.unrest, 3 * U_DIRT, 2 * DT * U_DIRT, "cell one's own");
  // below DIRT_UNREST it is no bother, and unrest falls
  dirt(w, 1, 1.5);
  z.unrest = 0.5;
  wait(w, 3);
  near(z.unrest, 0.5 - 3 * U_CALM, 2 * DT * U_CALM, "falls with the toilet under two");
  // capped at 1, and never under 0
  dirt(w, 0, 3.5);
  x.unrest = 0.99;
  x.needs.food = 0.2;
  wait(w, 2);
  assert.equal(x.unrest, 1);
  z.unrest = 0.01;
  wait(w, 2);
  assert.equal(z.unrest, 0);
});

test("unrest never feeds itself: an upset resident with all well calms down, for free", () => {
  const { w, first } = settle();
  const b = first.find((x) => x.house === "c1");
  b.unrest = 0.95;
  assert.equal(mood(L, b), "upset");
  wait(w, 3);
  near(b.unrest, 0.95 - 3 * U_CALM, 2 * DT * U_CALM, "falling");
  until(w, () => mood(L, b) === "ok", 30, "calm again");
  until(w, () => b.unrest === 0, 30, "all the way down");
  // and the free way back from a dirty toilet: the player cleans it, unrest falls
  dirt(w, 1, 3);
  b.unrest = 0.7;
  stand(w, spot(1));
  until(w, () => w.dirt[key(1)].level === 0, 3, "cleaned by hand");
  stand(w, HALL);
  const now = b.unrest;
  wait(w, 2);
  assert.ok(b.unrest < now, "falls once it is clean");
});

test("unrest only changes as the game steps: a save and a load later it is as it was, and junk is none", () => {
  const { w, first } = settle();
  first[0].unrest = 0.42;
  first[0].needs.food = 0.2;
  const back = restore(JSON.stringify(w), LEVELS);
  assert.equal(back.agents.find((a) => a.id === first[0].id).unrest, 0.42);
  for (const [u, want] of [[2, 1], [-1, 0], ["x", 0], [null, 0], [NaN, 0]]) {
    const raw = JSON.parse(JSON.stringify(w));
    raw.agents.find((a) => a.id === first[0].id).unrest = u;
    assert.equal(restore(JSON.stringify(raw), LEVELS).agents.find((a) => a.id === first[0].id).unrest, want, String(u));
  }
});

test("upset earns nothing, like needy: only ok drops money", () => {
  const { w, first } = settle();
  for (const b of first) b.unrest = 1;
  w.floor = [];
  wait(w, L.coinEvery * 2);
  assert.ok(first.every((b) => mood(L, b) === "upset"));
  assert.equal(w.floor.length, 0, "upset: no money");
  for (const b of first) b.unrest = 0;
  until(w, () => w.floor.length > 0, L.coinEvery + 1, "money once ok");
});

test("an upset resident brings a squabble on as soon as a cross one does", () => {
  const rate = (setup) => {
    const { w, first } = settle();
    // a fourth at home, so there are enough for a squabble
    const extra = { ...structuredClone(first.find((b) => b.house === "c1")), id: w.nextId++, slot: 1 };
    w.agents.push(extra);
    setup(first[0]);
    w.fightIn = 80;
    wait(w, 1);
    return 80 - w.fightIn;
  };
  const calm = rate(() => {});
  const upset = rate((b) => (b.unrest = 1));
  const cross = rate((b) => (b.needs.food = 0));
  near(calm, 1, 2 * DT, "calm: one second a second");
  near(cross, L.fights.every / L.fights.crossEvery, 0.1, "cross: sooner");
  near(upset, cross, 1e-9, "upset: the same as cross");
});

test("on screen: only ok sleeps, upset looks as red as cross, and the toilet is drawn by whole levels", () => {
  const { w, first } = settle();
  const b = first[0];
  b.rest = 5;
  b.moving = false;
  assert.equal(actionOf(w, L, b), "sleep");
  b.unrest = 0.8;
  assert.equal(actionOf(w, L, b), "stand", "upset stays awake");
  assert.equal(poseMood(L, b), "upset");
  const head = (m) => {
    let c = null;
    model.pose({ kind: "agent", action: "stand", walk: 0, t: 0, look: 0, uniform: true, carry: 0, mood: m }, (part, ...rest) => {
      if (part === "head") c = rest[rest.length - 1];
    });
    return c;
  };
  assert.equal(head("upset"), head("cross"));
  assert.notEqual(head("upset"), head("ok"));
  assert.equal(head("needy"), head("ok"));
  for (const [level, stage] of [[0, 0], [0.01, 1], [0.8, 1], [1, 1], [1.99, 1], [2, 2], [3.5, 3], [3.999, 3], [4, 4]]) assert.equal(dirtStage(level), stage, String(level));
  // the player cleaning a toilet looks like cleaning
  dirt(w, 0, 2, 0.1);
  stand(w, spot(0));
  player(w).moving = false;
  assert.equal(actionOf(w, L, player(w)), "clean");
});

test("a new jail starts with clean toilets and nobody restless", () => {
  const { w } = settle();
  dirt(w, 0, 3, 0.1, 2);
  w.coins = 500;
  w.rank = 6;
  const next = L.pads.find((p) => p.id === "next");
  stand(w, next.at);
  wait(w, 2);
  assert.equal(w.level, 1);
  assert.deepEqual(w.dirt, {});
  assert.ok(w.agents.every((a) => a.unrest === 0));
});
