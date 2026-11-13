import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { create, step, restore, padVisible, STAMP_AT } from "../src/engine/sim.ts";
import { LEVELS, MAP } from "../src/content/jail.ts";
import { readSlot, writeSlot } from "../src/lib/storage.ts";
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
    data, writes: [], full: false, blocked: false,
    getItem(k) {
      if (s.blocked) throw new Error("SecurityError");
      return data.has(k) ? data.get(k) : null;
    },
    setItem(k, v) {
      if (s.blocked) throw new Error("SecurityError");
      if (s.full) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
      data.set(k, String(v));
      s.writes.push(k);
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true });
  return s;
}
const store = { read: readSlot, write: writeSlot };
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
  const { atlas, from } = load(store, LEVELS, 3);
  assert.equal(from, "fresh");
  stepN(atlas.world, 600);
  assert.ok(atlas.world.agents.some((x) => x.kind === "agent"), "the bus came");
  assert.equal(save(store, atlas), false);
  assert.equal(record(atlas).active, "jail1");
});
