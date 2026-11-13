import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { create, step, restore, padVisible, STAMP_AT } from "../src/engine/sim.ts";
import { LEVELS, MAP } from "../src/content/jail.ts";
import { tryReadSlot, writeSlot } from "../src/lib/storage.ts";
import {
  ASIDE_KEY, MAP_KEY, OLD_KEY, fromOld, load, newAtlas, readMap, record, rows, save, startOver, travel, unlockNext,
} from "../src/lib/map.ts";

// many jails on a map, one saved record for them all, and the old one-jail save moved over once and
// never touched. the store here is the real storage.ts over a stand-in localStorage that can be made
// to throw, the way a full or blocked one does in a browser
const OLD = readFileSync(new URL("./fixtures/v0.1.21-save.json", import.meta.url), "utf8");
const STILL = { x: 0, y: 0 };

function fakeStorage() {
  const data = new Map();
  const s = {
    // `throwReads`: how many reads to come throw, as a store does that is there but will not answer
    data, writes: [], removed: [], full: false, blocked: false, throwReads: 0, throwKey: null,
    getItem(k) {
      if (s.blocked || k === s.throwKey) throw new Error("SecurityError");
      if (s.throwReads > 0) {
        s.throwReads--;
        throw new Error("SecurityError");
      }
      return data.has(k) ? data.get(k) : null;
    },
    setItem(k, v) {
      if (s.blocked) throw new Error("SecurityError");
      if (s.full) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
      data.set(k, String(v));
      s.writes.push(k);
    },
    removeItem(k) {
      s.removed.push(k);
      data.delete(k);
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true });
  return s;
}
const store = { read: tryReadSlot, write: writeSlot };
/** the old save is a backup: never written, never removed */
const oldUntouched = (ls) => {
  assert.ok(!ls.writes.includes(OLD_KEY), "the old save was written");
  assert.deepEqual(ls.removed, [], "something was removed");
};
const sum = (o) => Object.values(o).reduce((n, c) => n + c, 0);
/** every coin a world holds: wallet, piles, collectors' bags, the floor */
const total = (w) => w.coins + sum(w.piles) + w.agents.reduce((n, a) => n + (a.cash ?? 0), 0) + w.floor.length;
const quiet = (w) => Object.assign(w, { ride: { ...w.ride, t: 1e9 }, fightIn: 1e9, boost: { ...w.boost, t: 1e9 } });
const nextPad = LEVELS[0].pads.find((p) => p.id === "next");
const stepN = (w, n, levels = LEVELS) => {
  for (let i = 0; i < n; i++) step(w, levels, STILL);
};
/** a jail 1 world at rank 6, its warden standing on the next jail pad with money to pay it */
function onNextPad(coins = 500) {
  const w = quiet(create(LEVELS, 0, 7));
  Object.assign(w, { rank: 6, coins });
  Object.assign(w.agents[0], { x: nextPad.at.x, y: nextPad.at.y });
  return w;
}

test("the content: stable ids, display names, and two places coming later that are never sold", () => {
  assert.deepEqual(LEVELS.map((l) => l.id), ["jail1", "jail2"]);
  assert.deepEqual(LEVELS.map((l) => l.name), ["pine hill", "desert rock"]);
  assert.deepEqual(MAP.map((p) => [p.id, p.name, !!p.later]), [
    ["jail1", "pine hill", false], ["jail2", "desert rock", false], ["jail3", "snowy peak", true], ["jail4", "island bay", true],
  ]);
  // the pad stays rank 6 at the scaled 200, and the last jail has none
  assert.deepEqual([nextPad.rank, nextPad.cost], [6, 200]);
  assert.ok(LEVELS[1].pads.every((p) => !p.unlock.level));
  const a = newAtlas(LEVELS, 1);
  assert.deepEqual(rows(a, MAP).map((r) => r.state), ["here", "locked", "later", "later"]);
  a.unlocked.push("jail2");
  assert.deepEqual(rows(a, MAP).map((r) => r.state), ["here", "open", "later", "later"]);
});

test("an old jail 1 save moves over as jail 1, is written once, and the old save is left as it was", () => {
  const ls = fakeStorage();
  ls.data.set(OLD_KEY, OLD);
  const first = load(store, LEVELS, 99);
  assert.equal(first.from, "old");
  assert.equal(first.saved, true);
  assert.deepEqual(ls.writes, [MAP_KEY], "one write, the map record");
  assert.equal(first.atlas.active, "jail1");
  assert.deepEqual(first.atlas.unlocked, ["jail1"]);
  assert.deepEqual(first.atlas.world, restore(OLD, LEVELS), "the same world restore() gives");
  assert.equal(ls.data.get(OLD_KEY), OLD, "the backup untouched");
  // again: the map is read, the old save is not, nothing is written
  const again = load(store, LEVELS, 5);
  assert.equal(again.from, "map");
  assert.deepEqual(ls.writes, [MAP_KEY]);
  assert.deepEqual(again.atlas.world, first.atlas.world);
  assert.deepEqual(again.atlas.unlocked, ["jail1"]);
  assert.equal(ls.data.get(OLD_KEY), OLD);
});

test("an old jail 2 save becomes jail 2, with jail 1 unlocked and a fresh visit, nothing made up", () => {
  const ls = fakeStorage();
  const old = { ...create(LEVELS, 1, 3), coins: 77, rank: 4, steps: 900 };
  const raw = JSON.stringify(old);
  ls.data.set(OLD_KEY, raw);
  const { atlas, from } = load(store, LEVELS, 1);
  assert.equal(from, "old");
  assert.equal(atlas.active, "jail2");
  assert.deepEqual(atlas.unlocked, ["jail1", "jail2"]);
  assert.equal(atlas.world.level, 1, "level still matches its jail");
  assert.deepEqual([atlas.world.coins, atlas.world.rank, atlas.world.steps], [77, 4, 900]);
  assert.deepEqual(atlas.worlds, {}, "no jail 1 progress claimed");
  const there = travel(store, atlas, LEVELS, "jail1", 11);
  assert.ok(there);
  assert.equal(there.world.level, 0);
  assert.deepEqual([there.world.coins, there.world.rank, there.world.steps], [0, 1, 0], "jail 1 starts fresh");
  // jail 2 is open already, so its pad is gone in the fresh jail 1: never paid for twice
  assert.ok(!padVisible(there.world, nextPad));
  assert.equal(ls.data.get(OLD_KEY), raw);
  // an old save that cannot be read is no map at all
  for (const bad of [null, "{nope", JSON.stringify({ ...old, level: 7 }), JSON.stringify({ ...old, v: 2 })]) assert.equal(fromOld(bad, LEVELS), null);
});

test("a write that throws while moving over: the game plays on, nothing claims it moved, and it tries again next time", () => {
  const ls = fakeStorage();
  ls.data.set(OLD_KEY, OLD);
  ls.full = true;
  const first = load(store, LEVELS, 1);
  assert.equal(first.saved, false);
  assert.equal(first.from, "old");
  assert.equal(ls.data.has(MAP_KEY), false, "no map record claimed");
  assert.deepEqual(first.atlas.world, restore(OLD, LEVELS), "the old jail is in play, in memory");
  stepN(first.atlas.world, 30);
  assert.equal(save(store, first.atlas), false);
  ls.full = false;
  const next = load(store, LEVELS, 1);
  assert.equal(next.from, "old", "moved over on the next open, once it can be written");
  assert.equal(next.saved, true);
  assert.equal(ls.data.get(OLD_KEY), OLD);
});

test("a map record that cannot be read: never the old backup, a fresh jail not saving, the backup kept", () => {
  const variants = [
    "{broken",
    JSON.stringify({ v: 9, active: "jail1", unlocked: ["jail1"], worlds: {} }),
    JSON.stringify({ v: 1, active: "jail1", unlocked: ["jail1"], worlds: {} }),
    JSON.stringify({ v: 1, active: "jail1", unlocked: ["jail2"], worlds: { jail1: JSON.parse(OLD) } }),
    JSON.stringify({ v: 1, active: "jail1", unlocked: ["jail1"], worlds: { jail1: { v: 3, agents: "x" } } }),
    JSON.stringify({ v: 1, active: "jail1", unlocked: ["jail1", "jail2"], worlds: { jail1: JSON.parse(OLD), jail2: 5 } }),
  ];
  for (const raw of variants) {
    const ls = fakeStorage();
    ls.data.set(OLD_KEY, OLD);
    ls.data.set(MAP_KEY, raw);
    const got = load(store, LEVELS, 4);
    assert.equal(got.from, "unreadable", raw);
    assert.equal(got.saved, false, "the warning shows");
    assert.equal(got.atlas.world.coins, 0, "fresh, not the old save brought back");
    assert.equal(got.atlas.world.steps, 0);
    assert.deepEqual(ls.writes, [], "nothing written on the way in");
    // the first save puts the unreadable record aside, then writes the map. if that cannot be done,
    // nothing is written over it
    ls.full = true;
    assert.equal(save(store, got.atlas), false);
    assert.equal(ls.data.get(MAP_KEY), raw);
    ls.full = false;
    assert.equal(save(store, got.atlas), true);
    assert.equal(ls.data.get(ASIDE_KEY), raw, "kept aside");
    assert.equal(readMap(ls.data.get(MAP_KEY), LEVELS).world.steps, 0);
    assert.equal(ls.data.get(OLD_KEY), OLD, "the backup never touched");
  }
});

test("each save is one write", () => {
  const ls = fakeStorage();
  const a = newAtlas(LEVELS, 1);
  a.worlds.jail2 = JSON.parse(JSON.stringify(create(LEVELS, 1, 2)));
  a.unlocked.push("jail2");
  for (let i = 0; i < 3; i++) save(store, a);
  assert.deepEqual(ls.writes, [MAP_KEY, MAP_KEY, MAP_KEY]);
  assert.deepEqual(Object.keys(JSON.parse(ls.data.get(MAP_KEY)).worlds).sort(), ["jail1", "jail2"]);
});

test("the next jail pad: paid once, it opens jail 2 and she stays; later, go, and a reload never pay again", () => {
  const ls = fakeStorage();
  const a = newAtlas(LEVELS, 1);
  a.world = onNextPad(500);
  const before = JSON.parse(JSON.stringify(a.world));
  stepN(a.world, 120);
  assert.ok(a.world.bought.includes("next"));
  assert.equal(a.world.coins, 300, "200 paid, once");
  assert.equal(a.world.level, 0, "no move inside the step");
  assert.equal(a.world.agents.length, before.agents.length, "nobody gone");
  assert.equal(unlockNext(a, LEVELS), "jail2");
  assert.equal(unlockNext(a, LEVELS), null, "asking again opens nothing new");
  assert.deepEqual(a.unlocked, ["jail1", "jail2"]);
  // later: she plays on standing right there, and nothing more is taken
  stepN(a.world, 300);
  assert.equal(a.world.coins, 300);
  assert.equal(a.world.bought.filter((id) => id === "next").length, 1);
  // a reload finds it all as it was
  assert.equal(save(store, a), true);
  const back = load(store, LEVELS, 1).atlas;
  assert.deepEqual(back.unlocked, ["jail1", "jail2"]);
  assert.equal(back.world.coins, 300);
  assert.equal(unlockNext(back, LEVELS), null);
  // go now: jail 2, fresh at its own balance, no money carried over
  const there = travel(store, back, LEVELS, "jail2", 8);
  assert.equal(there.active, "jail2");
  assert.equal(there.world.level, 1);
  assert.equal(there.world.coins, 0);
  assert.deepEqual(rows(there, MAP).map((r) => r.state), ["open", "here", "later", "later"]);
  // and back: the pad still bought, the wallet the same, still nothing more to pay
  const home = travel(store, there, LEVELS, "jail1", 9);
  assert.equal(home.world.coins, 300);
  assert.ok(!padVisible(home.world, nextPad));
  stepN(home.world, 120);
  assert.equal(home.world.coins, 300);
  // a locked or unknown jail, or the one she is in, is no trip
  assert.equal(travel(store, newAtlas(LEVELS, 1), LEVELS, "jail2", 1), null);
  assert.equal(travel(store, home, LEVELS, "jail3", 1), null);
  assert.equal(travel(store, home, LEVELS, "jail1", 1), null);
});

test("there and back: collector cash, a fairy at work, dirt, a part-paid pad and a stamped departure all kept", () => {
  const ls = fakeStorage();
  const w = quiet(create(LEVELS, 0, 7));
  w.coins = 41;
  w.rank = 5;
  w.paid = { cell3: 5 };
  w.piles = { safe: 4, desk: 3 };
  w.floor = [{ x: 100, y: 176, house: "c0" }];
  const me = w.agents[0];
  w.agents.push({ ...me, id: w.nextId++, kind: "collector", x: 60, y: 700, cash: 9, trail: [], path: [] });
  w.bought.push("collector");
  // someone set free, papers stamped, at the release desk
  w.agents.push({ ...me, id: w.nextId++, kind: "agent", state: "stamp", station: "stamp", seat: 0, t: STAMP_AT + 0.1, x: 600, y: 704, path: [], trail: [], needs: { food: 1, wash: 1, toilet: 1 } });
  w.dirt = { "toilets:0": { level: 2.5, clean: 0.1, removed: 3 }, "toilets:1": { level: 1, clean: 0, removed: 0 } };
  w.fairy = { todo: [{ key: "toilets:0", amount: 2, removedAt: 3 }], visits: 1, x: 300, y: 200, target: { key: "toilets:1", amount: 1, removedAt: 0 }, t: 0.2 };
  w.steps = 4321;
  const a = { ...newAtlas(LEVELS, 1), world: w, unlocked: ["jail1", "jail2"] };
  const was = JSON.parse(JSON.stringify(w));
  const coins = total(w);

  const there = travel(store, a, LEVELS, "jail2", 3);
  assert.ok(there);
  stepN(there.world, 200);
  const value2 = total(there.world);
  const back = travel(store, there, LEVELS, "jail1", 4);
  assert.ok(back);
  // what restore() does to any save, and only that: the clock and a hold cleared, bags into the safe
  assert.deepEqual(back.world, restore(JSON.stringify(was), LEVELS));
  assert.equal(back.world.piles.safe, 13);
  assert.equal(back.world.agents.find((x) => x.kind === "collector").cash, 0);
  assert.equal(total(back.world), coins, "not a coin made or lost");
  assert.deepEqual(back.world.fairy, was.fairy);
  assert.deepEqual(back.world.dirt, was.dirt);
  assert.equal(back.world.paid.cell3, 5);
  const gone = back.world.agents.find((x) => x.state === "stamp");
  assert.equal(gone.t, STAMP_AT + 0.1);
  assert.equal(back.world.steps, 4321, "no time passed while she was away");
  assert.equal(back.world.released, was.released, "no new reward for coming back");
  // jail 2 is kept too, as she left it
  assert.equal(total(restore(JSON.stringify({ ...back.worlds.jail2, level: 1 }), LEVELS)), value2);
  // and a reload of the record gives the same
  assert.deepEqual(load(store, LEVELS, 1).atlas.world, back.world);
});

test("a write that throws on the way: she does not go, and nothing changes", () => {
  const ls = fakeStorage();
  const a = { ...newAtlas(LEVELS, 1), unlocked: ["jail1", "jail2"] };
  a.world.coins = 12;
  assert.equal(save(store, a), true);
  const stored = ls.data.get(MAP_KEY);
  const world = a.world;
  ls.full = true;
  assert.equal(travel(store, a, LEVELS, "jail2", 1), null);
  assert.equal(a.active, "jail1");
  assert.equal(a.world, world, "the same world in play");
  assert.equal(a.world.coins, 12);
  assert.deepEqual(a.worlds, {});
  assert.equal(ls.data.get(MAP_KEY), stored);
  // storage blocked outright: the same
  ls.full = false;
  ls.blocked = true;
  assert.equal(travel(store, a, LEVELS, "jail2", 1), null);
  assert.equal(a.active, "jail1");
});

test("start over: only the open jail, unlocks and the other jails stay; a write that throws claims nothing", () => {
  const ls = fakeStorage();
  const a = { ...newAtlas(LEVELS, 1), unlocked: ["jail1", "jail2"] };
  a.world.coins = 50;
  a.world.bought.push("next");
  const there = travel(store, a, LEVELS, "jail2", 2);
  there.world.coins = 70;
  there.world.rank = 3;
  assert.equal(save(store, there), true);
  const jail1 = JSON.stringify(there.worlds.jail1);
  startOver(there, LEVELS, 5);
  assert.equal(there.active, "jail2");
  assert.equal(there.world.level, 1);
  assert.deepEqual([there.world.coins, there.world.rank, there.world.steps], [0, 1, 0]);
  assert.deepEqual(there.unlocked, ["jail1", "jail2"]);
  assert.equal(JSON.stringify(there.worlds.jail1), jail1);
  // the write fails: the fresh jail is what she plays, the warning is due, and the record is as it was
  const stored = ls.data.get(MAP_KEY);
  ls.full = true;
  assert.equal(save(store, there), false);
  assert.equal(ls.data.get(MAP_KEY), stored);
  ls.full = false;
  assert.equal(save(store, there), true);
  const back = load(store, LEVELS, 1).atlas;
  assert.equal(back.world.coins, 0);
  assert.equal(JSON.stringify(back.worlds.jail1), jail1);
  // starting jail 1 over with jail 2 open: its pad stays gone
  const home = travel(store, back, LEVELS, "jail1", 3);
  startOver(home, LEVELS, 6);
  assert.ok(home.world.bought.includes("next"));
  assert.equal(home.world.coins, 0);
});

test("saves follow their jail by id when the content changes order", () => {
  const ls = fakeStorage();
  const a = { ...newAtlas(LEVELS, 1), unlocked: ["jail1", "jail2"] };
  a.world.coins = 31;
  const there = travel(store, a, LEVELS, "jail2", 2);
  there.world.coins = 62;
  save(store, there);
  const swapped = [LEVELS[1], LEVELS[0]];
  const got = load(store, swapped, 1).atlas;
  assert.equal(got.active, "jail2");
  assert.equal(got.world.level, 0, "jail 2 is first now");
  assert.equal(swapped[got.world.level].id, "jail2");
  assert.equal(got.world.coins, 62);
  const home = travel(store, got, swapped, "jail1", 3);
  assert.equal(swapped[home.world.level].id, "jail1");
  assert.equal(home.world.coins, 31);
  stepN(home.world, 30, swapped);
  // an old save's level is a place in the old order, whatever the order now
  const old = fromOld(JSON.stringify(create(LEVELS, 1, 3)), swapped);
  assert.equal(old.active, "jail2");
  assert.equal(swapped[old.world.level].id, "jail2");
});

test("storage blocked outright: a fresh jail that plays, never saves, and needs no map", () => {
  const ls = fakeStorage();
  ls.blocked = true;
  const { atlas, from, saved } = load(store, LEVELS, 3);
  // a store that will not answer is not an empty one (review, pr 47): not "fresh", not saving
  assert.equal(from, "blind");
  assert.equal(saved, false);
  stepN(atlas.world, 600);
  assert.ok(atlas.world.agents.some((x) => x.kind === "agent"), "the bus came");
  assert.equal(save(store, atlas), false);
  assert.equal(record(atlas).active, "jail1");
});

// review holes (pr 47): the pad names its jail, a tab that is behind never writes, a read that
// throws is not an empty store, and the old save is never written or removed

/** jail 1's world with the next jail pad bought, in whatever content it is played */
function boughtNext(levels) {
  const i = levels.findIndex((l) => l.id === "jail1");
  const world = create(levels, i, 7);
  world.bought.push("next");
  return { active: "jail1", unlocked: ["jail1"], worlds: {}, world, aside: null };
}

test("the pad names the jail it opens: a reorder still opens jail2, and a jail put between never is", () => {
  assert.equal(nextPad.unlock.level, "jail2");
  // jail 2 first in the content: jail 1's pad still opens it, and a fresh jail 1 has it pre-bought
  const swapped = [LEVELS[1], LEVELS[0]];
  const a = boughtNext(swapped);
  assert.equal(unlockNext(a, swapped), "jail2");
  assert.deepEqual(a.unlocked, ["jail1", "jail2"]);
  startOver(a, swapped, 3);
  assert.ok(a.world.bought.includes("next"), "never paid twice");
  // a jail put in between is not opened for free by a pad bought before it was there
  const between = [LEVELS[0], { ...LEVELS[1], id: "jailx", name: "middle" }, LEVELS[1]];
  const b = boughtNext(between);
  assert.equal(unlockNext(b, between), "jail2");
  assert.ok(!b.unlocked.includes("jailx"));
  // a pad that names a jail the content does not have opens nothing
  const nowhere = [{ ...LEVELS[0], pads: LEVELS[0].pads.map((p) => (p.id === "next" ? { ...p, unlock: { level: "jail9" } } : p)) }, LEVELS[1]];
  const c = boughtNext(nowhere);
  assert.equal(unlockNext(c, nowhere), null);
  assert.deepEqual(c.unlocked, ["jail1"]);
});

test("a second tab that is behind never writes over the map, and is told to load again", () => {
  const ls = fakeStorage();
  const first = { ...newAtlas(LEVELS, 1), unlocked: ["jail1", "jail2"] };
  first.world.coins = 5;
  assert.equal(save(store, first), true);
  const A = load(store, LEVELS, 1).atlas, B = load(store, LEVELS, 1).atlas;
  const there = travel(store, A, LEVELS, "jail2", 2);
  assert.ok(there);
  const held = ls.data.get(MAP_KEY);
  B.world.coins = 999;
  assert.equal(save(store, B), false);
  assert.equal(B.stale, true);
  assert.equal(ls.data.get(MAP_KEY), held, "A's record stands");
  assert.equal(travel(store, B, LEVELS, "jail2", 3), null);
  assert.equal(B.stale, true);
  assert.equal(ls.data.get(MAP_KEY), held);
  // the tab that is ahead never trips on its own writes
  for (let i = 0; i < 3; i++) assert.equal(save(store, there), true);
  assert.equal(load(store, LEVELS, 1).atlas.active, "jail2");
  // a tab that opened with nothing stored, beaten to the first write by another
  const ls2 = fakeStorage();
  const C = load(store, LEVELS, 1).atlas, D = load(store, LEVELS, 1).atlas;
  assert.equal(save(store, C), true);
  const won = ls2.data.get(MAP_KEY);
  assert.equal(save(store, D), false);
  assert.equal(D.stale, true);
  assert.equal(ls2.data.get(MAP_KEY), won);
  oldUntouched(ls);
  oldUntouched(ls2);
});

test("a read that throws is not an empty store: not saving, no move over, nothing written until a read works", () => {
  const ls = fakeStorage();
  ls.data.set(OLD_KEY, OLD);
  ls.throwReads = 1;
  const got = load(store, LEVELS, 1);
  assert.equal(got.from, "blind");
  assert.equal(got.saved, false);
  assert.equal(got.atlas.world.steps, 0, "fresh, in memory");
  assert.deepEqual(ls.writes, [], "no move over claimed");
  stepN(got.atlas.world, 30);
  // the store answers again, and there was an old save under it: this tab writes nothing and loads again
  assert.equal(save(store, got.atlas), false);
  assert.equal(got.atlas.stale, true);
  assert.deepEqual(ls.writes, []);
  assert.equal(load(store, LEVELS, 1).from, "old");
  oldUntouched(ls);
  // with nothing under it, a save whose read throws writes nothing, and the first that can read goes ahead
  const ls2 = fakeStorage();
  ls2.throwReads = 1;
  const g2 = load(store, LEVELS, 1);
  assert.equal(g2.saved, false);
  ls2.throwReads = 1;
  assert.equal(save(store, g2.atlas), false);
  assert.deepEqual(ls2.writes, []);
  assert.equal(save(store, g2.atlas), true);
  assert.deepEqual(ls2.writes, [MAP_KEY]);
  assert.equal(g2.atlas.stale, false);
});

test("a trip is exactly one write, to the map, and the old save is never written or removed", () => {
  const ls = fakeStorage();
  ls.data.set(OLD_KEY, OLD);
  const a = load(store, LEVELS, 1).atlas;
  a.world.bought.push("next");
  unlockNext(a, LEVELS);
  assert.equal(save(store, a), true);
  ls.writes.length = 0;
  const there = travel(store, a, LEVELS, "jail2", 2);
  assert.deepEqual(ls.writes, [MAP_KEY]);
  startOver(there, LEVELS, 3);
  save(store, there);
  travel(store, there, LEVELS, "jail1", 4);
  oldUntouched(ls);
  assert.equal(ls.data.get(OLD_KEY), OLD);
});

test("a save that does not stick moves nothing on: a newer record written after it is still never written over", () => {
  const ls = fakeStorage();
  const first = { ...newAtlas(LEVELS, 1), unlocked: ["jail1", "jail2"] };
  assert.equal(save(store, first), true);
  const A = load(store, LEVELS, 1).atlas, B = load(store, LEVELS, 1).atlas;
  const gen = A.gen;
  ls.full = true;
  for (let i = 0; i < 3; i++) assert.equal(save(store, A), false);
  assert.equal(travel(store, A, LEVELS, "jail2", 2), null);
  assert.equal(A.gen, gen, "the count moves only once a write sticks");
  ls.full = false;
  // the other tab writes once, then A, behind it, may not write over it
  B.world.coins = 41;
  assert.equal(save(store, B), true);
  const held = ls.data.get(MAP_KEY);
  A.world.coins = 7;
  assert.equal(save(store, A), false);
  assert.equal(A.stale, true);
  assert.equal(ls.data.get(MAP_KEY), held);
  assert.equal(load(store, LEVELS, 1).atlas.world.coins, 41);
});

test("a tab that has stopped saving writes nothing at all, by any path", () => {
  const ls = fakeStorage();
  const a = { ...newAtlas(LEVELS, 1), unlocked: ["jail1", "jail2"] };
  assert.equal(save(store, a), true);
  ls.writes.length = 0;
  // as the page does when another tab writes the map
  a.stale = true;
  assert.equal(save(store, a), false);
  assert.equal(travel(store, a, LEVELS, "jail2", 2), null);
  assert.equal(a.active, "jail1");
  assert.deepEqual(ls.writes, []);
});

test("a map record that will not read is never taken for missing: no move over from the old save, nothing written", () => {
  // the reviewer's case: the map's read throws while the old save reads fine
  const ls = fakeStorage();
  ls.data.set(OLD_KEY, OLD);
  const kept = JSON.stringify({ ...record({ ...newAtlas(LEVELS, 1), gen: 4 }), gen: 4 });
  ls.data.set(MAP_KEY, kept);
  ls.throwKey = MAP_KEY;
  const got = load(store, LEVELS, 1);
  assert.equal(got.from, "blind");
  assert.equal(got.saved, false);
  assert.equal(got.atlas.world.coins, 0, "not the old save's wallet");
  for (let i = 0; i < 3; i++) assert.equal(save(store, got.atlas), false);
  assert.deepEqual(ls.writes, []);
  assert.equal(ls.data.get(MAP_KEY), kept);
  oldUntouched(ls);
  // a corrupt record is not missing either: it never brings the old save back
  const ls2 = fakeStorage();
  ls2.data.set(OLD_KEY, OLD);
  ls2.data.set(MAP_KEY, "{corrupt");
  const g2 = load(store, LEVELS, 1);
  assert.equal(g2.from, "unreadable");
  assert.notDeepEqual(g2.atlas.world, restore(OLD, LEVELS));
  assert.deepEqual(ls2.writes, []);
  oldUntouched(ls2);
});
