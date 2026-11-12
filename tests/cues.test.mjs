import { test } from "node:test";
import assert from "node:assert/strict";
import { create, step, route, player, followers, boostMult, DT } from "../src/engine/sim.ts";
import { cues, gains, snap } from "../src/engine/cues.ts";
import { LEVELS } from "../src/content/jail.ts";

const L = LEVELS[0];
const station = (id) => L.stations.find((s) => s.id === id);
const pad = (id) => L.pads.find((p) => p.id === id);
const desk = station("desk");
const HALL = { x: 330, y: 540 };

// a screen's ears: look at the world every `every` steps (a slow frame is up to 15) and keep what was heard
const ears = new WeakMap();
function listen(w, every = 1) {
  const ear = { every, n: 0, before: snap(w), heard: [], got: { coins: 0, stars: 0, bought: [] } };
  ears.set(w, ear);
  return ear.heard;
}
function tick(w, stick) {
  step(w, LEVELS, stick);
  const ear = ears.get(w);
  if (!ear || ++ear.n % ear.every) return;
  ear.heard.push(...cues(ear.before, w, LEVELS[w.level]));
  const g = gains(ear.before, w);
  ear.got.coins += g.coins;
  ear.got.stars += g.stars;
  ear.got.bought.push(...g.bought);
  ear.before = snap(w);
}
/** what was heard since the last take, and forget it */
const take = (w) => ears.get(w).heard.splice(0);
/** what there was to show since the last look, and forget it */
const shown = (w) => {
  const ear = ears.get(w), got = ear.got;
  ear.got = { coins: 0, stars: 0, bought: [] };
  return got;
};
const of = (list, kind) => list.filter((c) => c.kind === kind);
const sum = (list, kind) => of(list, kind).reduce((n, c) => n + c.n, 0);
const kinds = (list) => [...new Set(list.map((c) => c.kind))].sort();

// drive the player like a thumb would: full stick along the way round the walls
function go(w, to, cap = 60 * 40) {
  const p = player(w);
  const path = route(w, L, p, to);
  let still = 0;
  for (let i = 0; i < cap; i++) {
    if (!path.length) return;
    const t = path[0], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
    if (d < 1) {
      path.shift();
      continue;
    }
    const s = w.speed * boostMult(w, L) * DT, was = { x: p.x, y: p.y };
    tick(w, d < s ? { x: dx / s, y: dy / s } : { x: dx / d, y: dy / d });
    if (w.level !== 0) return;
    still = Math.hypot(p.x - was.x, p.y - was.y) < 0.01 ? still + 1 : 0;
    if (still > 30) assert.fail(`stuck at ${p.x.toFixed(0)},${p.y.toFixed(0)} on the way to ${to.x},${to.y}`);
  }
  assert.fail(`never reached ${to.x},${to.y}`);
}
const wait = (w, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) tick(w, { x: 0, y: 0 });
};
const until = (w, done, seconds, what) => {
  for (let i = 0; i < seconds * 60; i++) {
    if (done()) return;
    tick(w, { x: 0, y: 0 });
  }
  assert.fail(`waited ${seconds}s for ${what}`);
};
const inmates = (w) => w.agents.filter((a) => a.kind === "agent");
const count = (w, state) => inmates(w).filter((a) => a.state === state).length;
const line = (w) => followers(w, player(w));

/** the first busload checked in and led to cells 1 and 2, full up and at home */
function settle(seed = 7, every = 1) {
  const w = create(LEVELS, 0, seed);
  const heard = listen(w, every);
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
  assert.equal(first.length, 3);
  for (const b of first) for (const n of L.needs) b.needs[n.id] = 1;
  go(w, station("c0").at);
  go(w, station("c1").at);
  go(w, HALL);
  until(w, () => first.every((b) => b.state === "home"), 15, "everyone in bed");
  return { w, first, heard };
}

test("nothing happening is silence, and a look at the world changes nothing in it", () => {
  const w = create(LEVELS, 0, 7);
  const before = snap(w);
  assert.deepEqual(cues(before, w, L), [], "the same instant");
  const twin = create(LEVELS, 0, 7);
  listen(twin);
  for (let i = 0; i < 60 * 30; i++) {
    step(w, LEVELS, { x: Math.sin(i / 90), y: Math.cos(i / 70) });
    tick(twin, { x: Math.sin(i / 90), y: Math.cos(i / 70) });
  }
  assert.equal(JSON.stringify(twin), JSON.stringify(w), "listened to or not, the same game");
});

test("the first busload: the ride, three check-ins, the line, beds, coins, a pile", () => {
  const w = create(LEVELS, 0, 7);
  listen(w);
  until(w, () => count(w, "queue") === 3 && inmates(w).every((a) => a.state !== "arrive"), 20, "the first bus to queue up");
  assert.deepEqual(take(w), [{ kind: "ride", n: 1 }], "the ride pulling in, and nothing else yet");

  go(w, desk.at);
  until(w, () => count(w, "ready") === 3, 5, "three check-ins");
  let heard = take(w);
  assert.deepEqual(of(heard, "checkin"), [{ kind: "checkin", n: 1 }, { kind: "checkin", n: 1 }, { kind: "checkin", n: 1 }]);
  assert.deepEqual(kinds(heard), ["checkin"]);

  // the line holds two: each one who joins says how long it is now
  go(w, desk.out[1]);
  heard = take(w);
  assert.deepEqual(of(heard, "follow").map((c) => c.n), [1, 2]);
  go(w, station("c0").at);
  wait(w, 1);
  heard = take(w);
  assert.equal(sum(heard, "bed"), 2, "two into their beds");
  assert.equal(sum(heard, "seat"), 0);
  go(w, desk.out[2]);
  go(w, station("c1").at);
  wait(w, 0.6);
  heard = take(w);
  // the third, and maybe someone from the first cell who tagged along on the way past
  assert.equal(of(heard, "follow")[0].n, 1);
  assert.ok(sum(heard, "bed") >= 1, "the third into a bed");

  // the desk's pile, walked over
  go(w, HALL);
  take(w);
  const owed = w.piles.desk;
  assert.equal(owed, 3 * desk.pay);
  go(w, desk.pileAt);
  assert.deepEqual(of(take(w), "pile"), [{ kind: "pile", n: owed }]);

  // coins on the floor: one cue for each one picked up, none for one dropped
  go(w, HALL);
  until(w, () => w.floor.length > 0, 15, "a first coin");
  assert.equal(sum(take(w), "coin"), 0, "a coin dropping is not a coin picked up");
  const had = w.coins, lying = w.floor.length;
  for (const c of new Set(w.floor.map((x) => x.house))) go(w, station(c).at);
  heard = take(w);
  assert.ok(sum(heard, "coin") >= lying, `picked up ${sum(heard, "coin")} of ${lying}`);
  assert.equal(sum(heard, "coin"), w.coins - had, "one for each coin banked");
});

test("a price tag ticks as it fills, then opens once", () => {
  const { w } = settle();
  take(w);
  w.coins = 50;
  const cell3 = pad("cell3");
  go(w, cell3.at);
  wait(w, 1.5);
  const heard = take(w);
  assert.ok(w.bought.includes("cell3"));
  assert.deepEqual(of(heard, "buy"), [{ kind: "buy", n: 1 }]);
  const pays = of(heard, "pay");
  assert.equal(sum(heard, "pay"), cell3.cost - 1, "every coin but the last ticks: the last one opens it");
  assert.ok(pays.every((c, i) => c.fill > 0 && c.fill < 1 && (i === 0 || c.fill > pays[i - 1].fill)), "the tag fills as it goes");
  assert.deepEqual(kinds(heard.filter((c) => c.kind !== "coin")), ["buy", "pay"]);
  wait(w, 1);
  assert.deepEqual(of(take(w), "pay"), [], "a bought tag is quiet");
});

test("the canteen: a stack picked up, put down, and the hungry sitting down", () => {
  const { w, first } = settle();
  take(w);
  go(w, station("stove").at);
  until(w, () => player(w).carry === w.carryMax, 3, "a full stack");
  let heard = take(w);
  assert.deepEqual(of(heard, "carry").map((c) => c.n), Array.from({ length: w.carryMax }, (_, i) => i + 1));
  go(w, station("table1").at);
  until(w, () => player(w).carry === 0, 3, "the stack to go down");
  heard = take(w);
  assert.equal(sum(heard, "drop"), w.carryMax);
  assert.equal(sum(heard, "carry"), 0);

  for (const b of first) b.needs.food = 0.1;
  wait(w, 0.5);
  take(w);
  go(w, station("c0").at);
  wait(w, 0.3);
  const led = line(w).length;
  assert.ok(led > 0, "someone hungry to lead");
  go(w, station("table1").at);
  wait(w, 0.5);
  heard = take(w);
  assert.equal(sum(heard, "seat"), led, "each one who sat down");
  assert.equal(sum(heard, "bed"), 0);
});

test("set free: a bell for a release, and a level up speaks for the release that earned it", () => {
  const { w, first } = settle();
  for (const b of first) b.served = L.serve;
  wait(w, 0.1);
  go(w, station("c0").at);
  w.coins = 0;
  take(w);
  go(w, station("stamp").at);
  wait(w, 1.5);
  const heard = take(w);
  assert.equal(w.released, 2);
  assert.equal(w.rank, 2);
  assert.deepEqual(heard.filter((c) => c.kind === "release" || c.kind === "rank"), [{ kind: "release", n: 1 }, { kind: "rank", n: 2 }]);
  assert.equal(sum(heard, "bed") + sum(heard, "seat"), 0, "walking out is not a bed or a seat");
});

test("a mess wiped by the player is heard", () => {
  const { w } = settle(11);
  until(w, () => w.messes.some((m) => m.kind === "poop"), 240, "a messy toilet");
  const mess = w.messes.find((m) => m.kind === "poop");
  assert.equal(sum(take(w), "clean"), 0);
  go(w, mess);
  wait(w, 0.5);
  assert.ok(!w.messes.includes(mess));
  assert.deepEqual(of(take(w), "clean"), [{ kind: "clean", n: 1 }]);
});

test("a squabble: an alarm when it starts, a calm when it is settled", () => {
  const { w } = settle();
  w.coins = 50;
  go(w, pad("cell3").at);
  wait(w, 1.5);
  until(w, () => count(w, "queue") > 0, 20, "the next bus");
  go(w, desk.at);
  until(w, () => count(w, "ready") === 3, 5, "check-ins");
  go(w, desk.out[2]);
  go(w, station("c1").at);
  wait(w, 0.6);
  go(w, desk.out[0]);
  go(w, station("c2").at);
  until(w, () => count(w, "home") >= 4, 15, "four at home");
  take(w);
  w.fightIn = 0;
  wait(w, 0.1);
  assert.ok(w.alert);
  assert.deepEqual(of(take(w), "fight"), [{ kind: "fight", n: 1 }]);
  wait(w, L.fights.settle + 1);
  let heard = take(w);
  assert.equal(sum(heard, "fight") + sum(heard, "calm"), 0, "still going: said once");
  go(w, w.alert);
  wait(w, L.fights.settle + 0.2);
  heard = take(w);
  assert.equal(w.alert, null);
  assert.deepEqual(of(heard, "calm"), [{ kind: "calm", n: 1 }]);
  assert.equal(sum(heard, "fight"), 0);
});

test("a speed boost is heard once, when it is picked up", () => {
  const w = create(LEVELS, 0, 3);
  listen(w);
  w.boost.t = 0;
  wait(w, 0.1);
  assert.ok(w.boost.here);
  w.boostKind = "skates";
  go(w, w.boost);
  wait(w, L.boost.kinds.skates.time + 0.5);
  assert.equal(w.boosted, 0);
  assert.deepEqual(of(take(w), "skates"), [{ kind: "skates", n: 1 }]);
});

// a boost of this kind dropped where the player stands, with a mess or none on the floor, listened to `every` steps
function pickUp(kind, { mess = true, every = 1, boosted = 0, mount = "skates" } = {}) {
  const w = create(LEVELS, 0, 3);
  listen(w, every);
  const p = player(w);
  if (mess) w.messes.push({ id: w.nextId++, kind: "puddle", x: p.x + 60, y: p.y, station: "showers", seat: 0, clean: 0 });
  w.boosted = boosted;
  w.mountKind = mount;
  w.boost = { x: p.x, y: p.y, here: true, t: 0 };
  w.boostKind = kind;
  ears.get(w).before = snap(w);
  for (let i = 0; i < every; i++) tick(w, { x: 0, y: 0 });
  return { w, heard: take(w) };
}
const boostCues = (heard) => heard.filter((c) => ["skates", "unicorn", "fairy", "ride"].includes(c.kind));

test("each surprise has its own pickup sound, once, and the fairy is heard though she gives no ride", () => {
  for (const kind of ["skates", "unicorn", "fairy"])
    for (const every of [1, 15]) {
      const { w, heard } = pickUp(kind, { every });
      assert.deepEqual(boostCues(heard), [{ kind, n: 1 }], `${kind}, a look every ${every}`);
      if (kind === "fairy") assert.equal(w.boosted, 0, "no ride");
    }
  // a new ride while a longer one is still on is still heard, by what was picked up
  const { heard } = pickUp("skates", { boosted: 14.9, mount: "unicorn", every: 15 });
  assert.deepEqual(boostCues(heard), [{ kind: "skates", n: 1 }]);
});

test("a fairy picked up on a clean floor comes as skates, and sounds like skates", () => {
  const { w, heard } = pickUp("fairy", { mess: false });
  assert.equal(w.mountKind, "skates");
  assert.ok(w.boosted > 0);
  assert.deepEqual(boostCues(heard), [{ kind: "skates", n: 1 }]);
});

test("a fairy who cleans her only mess and is gone before the next look still sounds like a fairy", () => {
  const w = create(LEVELS, 0, 3);
  listen(w, 15);
  const p = player(w);
  // the mess is right under her and nearly clean, so she finishes inside one batch of steps
  w.messes.push({ id: w.nextId++, kind: "puddle", x: p.x, y: p.y, station: "showers", seat: 0, clean: 0.2 });
  w.boost = { x: p.x, y: p.y, here: true, t: 0 };
  w.boostKind = "fairy";
  ears.get(w).before = snap(w);
  for (let i = 0; i < 15; i++) tick(w, { x: 0, y: 0 });
  assert.equal(w.fairy.target, null, "she is gone already");
  assert.equal(w.boosted, 0, "no ride");
  assert.deepEqual(boostCues(take(w)), [{ kind: "fairy", n: 1 }]);
});

test("the ride's cue is still the ride's, untouched by a boost", () => {
  const w = create(LEVELS, 0, 7);
  listen(w);
  until(w, () => w.ride.state !== "away", 20, "the ride");
  assert.deepEqual(boostCues(take(w)), [{ kind: "ride", n: 1 }]);
});

test("a new level says only that; a fresh start says nothing", () => {
  const { w } = settle();
  w.coins = 500;
  w.rank = 6;
  take(w);
  go(w, pad("next").at);
  wait(w, 2);
  assert.equal(w.level, 1);
  const heard = take(w);
  assert.deepEqual(of(heard, "level"), [{ kind: "level", n: 2 }]);
  assert.equal(sum(heard, "buy"), 0, "the level's own fanfare, not a pad's");

  // the old world's snap against a brand new one, as after "start over"
  const old = settle().w;
  const before = snap(old);
  assert.deepEqual(cues(before, create(LEVELS, 0, 5), L), []);
});

test("hired help working alone is silent: only what the player does is heard", () => {
  const { w } = settle();
  w.coins = 500;
  w.rank = 4;
  go(w, pad("cell3").at);
  wait(w, 1.5);
  for (const id of ["cook", "guard", "clerk", "cleaner"]) {
    go(w, pad(id).at);
    wait(w, 1.5);
  }
  go(w, HALL);
  take(w);
  const released = w.released, ids = (state) => inmates(w).filter((a) => a.state === state).map((a) => a.id);
  let wiped = 0, checked = 0, sat = 0, messes = new Set(w.messes), queue = ids("queue");
  for (let i = 0; i < 60 * 300 && !(wiped && checked && sat && w.released > released); i++) {
    tick(w, { x: 0, y: 0 });
    for (const m of messes) if (!w.messes.includes(m)) wiped++;
    messes = new Set(w.messes);
    const now = ids("queue");
    checked += queue.filter((id) => !now.includes(id)).length;
    queue = now;
    if (inmates(w).some((b) => b.state === "go")) sat++;
  }
  assert.ok(checked > 0, "the clerk checked someone in");
  assert.ok(sat > 0, "the guard led someone to a seat");
  assert.ok(wiped > 0, "the cleaner wiped something");
  assert.ok(w.released > released, "the guard set someone free");
  const heard = take(w);
  for (const kind of ["checkin", "follow", "bed", "seat", "carry", "drop", "clean", "coin", "pile", "pay", "buy"])
    assert.equal(sum(heard, kind), 0, `${kind} with the player standing still`);
  assert.ok(sum(heard, "release") + of(heard, "rank").length > 0, "a release is everyone's good news");
});

test("a slow frame of many steps hears the same story", () => {
  const story = (every) => {
    const { w, first, heard } = settle(7, every);
    for (const b of first) b.served = L.serve;
    wait(w, 0.1);
    go(w, station("c0").at);
    w.coins = 0;
    go(w, station("stamp").at);
    wait(w, 1.5);
    return heard.slice();
  };
  const fine = story(1), slow = story(15);
  for (const kind of ["checkin", "bed", "ride"]) assert.equal(sum(slow, kind), sum(fine, kind), kind);
  assert.equal(sum(fine, "checkin"), 3);
  assert.equal(of(slow, "follow").length > 0, true);
  assert.deepEqual(of(slow, "rank"), [{ kind: "rank", n: 2 }]);
  assert.equal(sum(slow, "release") + 1, 2, "one release, and the level up for the other");
});

test("what came in: coins off the floor and from a pile, and a pad bought", () => {
  const w = create(LEVELS, 0, 7);
  listen(w);
  until(w, () => count(w, "queue") === 3 && inmates(w).every((a) => a.state !== "arrive"), 20, "the first bus to queue up");
  go(w, desk.at);
  until(w, () => count(w, "ready") === 3, 5, "three check-ins");
  go(w, HALL);
  assert.deepEqual(shown(w), { coins: 0, stars: 0, bought: [] }, "a pile building up is not coins in hand");
  const owed = w.piles.desk;
  go(w, desk.pileAt);
  assert.deepEqual(shown(w), { coins: owed, stars: 0, bought: [] }, "the pile, once");
  wait(w, 1);
  assert.deepEqual(shown(w), { coins: 0, stars: 0, bought: [] }, "and nothing after");

  const s = settle();
  until(s.w, () => s.w.floor.length > 0, 15, "a first coin");
  shown(s.w);
  take(s.w);
  const had = s.w.coins;
  for (const c of new Set(s.w.floor.map((x) => x.house))) go(s.w, station(c).at);
  assert.ok(s.w.coins > had);
  assert.deepEqual(shown(s.w), { coins: s.w.coins - had, stars: 0, bought: [] });

  // paying into a pad is money going out: only the pad shows
  s.w.coins = 50;
  wait(s.w, 1 / 60);
  shown(s.w);
  take(s.w);
  go(s.w, pad("cell3").at);
  wait(s.w, 1.5);
  const heard = take(s.w), got = shown(s.w);
  assert.deepEqual(got.bought, ["cell3"]);
  assert.equal(got.stars, 0);
  assert.equal(got.coins, sum(heard, "coin") + sum(heard, "pile"), "no more than was picked up on the way");
  assert.ok(s.w.coins < 50, "and the price did go out");
});

test("what came in: a star for each one set free, and the coins a level up pays", () => {
  const { w, first } = settle();
  for (const b of first) b.served = L.serve;
  wait(w, 0.1);
  go(w, station("c0").at);
  w.coins = 0;
  wait(w, 1 / 60);
  shown(w);
  go(w, station("stamp").at);
  wait(w, 1.5);
  assert.equal(w.released, 2);
  assert.equal(w.rank, 2);
  const got = shown(w);
  assert.equal(got.stars, 2);
  assert.equal(got.coins, w.coins, "every coin in hand came in since");
  assert.ok(got.coins >= L.rankReward, "the level up pays");
  assert.deepEqual(got.bought, []);
});

test("what came in: nothing for a new level or a fresh start, and a slow frame adds up the same", () => {
  const { w } = settle();
  const before = snap(w);
  const fresh = create(LEVELS, 0, 5);
  fresh.coins = before.coins + 9;
  fresh.released = before.released + 1;
  fresh.bought.push("cell3");
  assert.deepEqual(gains(before, fresh), { coins: 0, stars: 0, bought: [] }, "a fresh start");
  const next = create(LEVELS, 1, 5);
  next.steps = before.steps + 1;
  next.coins = before.coins + 9;
  next.released = before.released + 1;
  next.bought.push("cell3");
  assert.deepEqual(gains(before, next), { coins: 0, stars: 0, bought: [] }, "a new level");
  assert.deepEqual(gains(before, w), { coins: 0, stars: 0, bought: [] }, "the same instant");
  const same = create(LEVELS, 0, 5);
  same.steps = before.steps;
  same.coins = before.coins + 9;
  same.released = before.released + 1;
  same.bought.push("cell3");
  assert.deepEqual(gains(before, same), { coins: 0, stars: 0, bought: [] }, "a world that has not moved on");
  const later = create(LEVELS, 0, 5);
  later.steps = before.steps + 1;
  later.coins = 0;
  assert.deepEqual(gains({ ...before, coins: 50, released: 3 }, later), { coins: 0, stars: 0, bought: [] }, "fewer than before is none, never less than none");

  const story = (every) => {
    const s = settle(7, every);
    for (const b of s.first) b.served = L.serve;
    wait(s.w, 0.1);
    go(s.w, station("c0").at);
    go(s.w, station("stamp").at);
    wait(s.w, 1.5);
    return { got: shown(s.w), w: s.w };
  };
  const fine = story(1), slow = story(15);
  assert.deepEqual(slow.got, fine.got);
  assert.equal(fine.got.stars, fine.w.released);
  const paid = Object.values(fine.w.paid).reduce((n, c) => n + c, 0);
  assert.equal(fine.got.coins, fine.w.coins + paid, "all of it is in hand or in a price tag");
  assert.ok(fine.got.coins > 0 && fine.got.stars > 0);
});

/** a quiet jail with a collector hired, the player parked in the hall, and an ear on it */
function withCollector(every = 1) {
  const w = create(LEVELS, 0, 7);
  w.ride.t = 1e9;
  w.boost.t = 1e9;
  w.coins = 1000;
  w.rank = 5;
  go(w, pad("collector").at);
  until(w, () => w.bought.includes("collector"), 4, "the collector hired");
  go(w, HALL);
  const h = w.agents.find((a) => a.kind === "collector");
  listen(w, every);
  return { w, h };
}
const safe = station("safe");

test("a collector gathering and putting coins in the safe is silent, and shows nothing", () => {
  for (const every of [1, 15]) {
    const { w, h } = withCollector(every);
    const wallet = w.coins;
    w.piles.desk = 8;
    w.piles.stamp = 10;
    let gathered = 0;
    until(w, () => (gathered = Math.max(gathered, h.cash)) && (w.piles.safe ?? 0) === 18, 80, "both piles in the safe");
    const heard = take(w), got = shown(w);
    assert.equal(sum(heard, "pile"), 0, "no pile cue for a collector's pile");
    assert.equal(sum(heard, "coin"), 0);
    assert.equal(got.coins, 0, "no +n");
    assert.equal(w.coins, wallet);
    assert.ok(gathered > 0);
  }
});

test("coins put in the safe and taken out by the player in one look: only what the player took", () => {
  // the collector puts 6 in, then the player takes all 16, before anyone looks
  const a = withCollector(1e9);
  a.w.piles.safe = 10;
  Object.assign(a.h, { x: safe.at.x, y: safe.at.y, path: [], cash: 6 });
  const ear = ears.get(a.w);
  ear.before = snap(a.w);
  step(a.w, LEVELS, { x: 0, y: 0 });
  assert.equal(a.w.piles.safe, 16, "in");
  Object.assign(player(a.w), { x: safe.pileAt.x, y: safe.pileAt.y });
  step(a.w, LEVELS, { x: 0, y: 0 });
  assert.equal(a.w.piles.safe, 0, "and out");
  assert.deepEqual(of(cues(ear.before, a.w, L), "pile"), [{ kind: "pile", n: 16 }]);
  assert.equal(gains(ear.before, a.w).coins, 16);

  // the player takes the 10 there were, then the collector puts in 15: the safe is fuller than before, still 10 were taken
  const b = withCollector(1e9);
  b.w.piles.safe = 10;
  const eb = ears.get(b.w);
  eb.before = snap(b.w);
  const was = { x: player(b.w).x, y: player(b.w).y };
  Object.assign(player(b.w), { x: safe.pileAt.x, y: safe.pileAt.y });
  step(b.w, LEVELS, { x: 0, y: 0 });
  Object.assign(player(b.w), was);
  Object.assign(b.h, { x: safe.at.x, y: safe.at.y, path: [], cash: 15 });
  step(b.w, LEVELS, { x: 0, y: 0 });
  assert.equal(b.w.piles.safe, 15);
  assert.deepEqual(of(cues(eb.before, b.w, L), "pile"), [{ kind: "pile", n: 10 }]);
  assert.equal(gains(eb.before, b.w).coins, 10);

  // the same step: the player takes the 10, then the collector puts its 6 in
  const c = withCollector(1e9);
  c.w.piles.safe = 10;
  const ec = ears.get(c.w);
  ec.before = snap(c.w);
  Object.assign(c.h, { x: safe.at.x, y: safe.at.y, path: [], cash: 6 });
  Object.assign(player(c.w), { x: safe.pileAt.x, y: safe.pileAt.y });
  step(c.w, LEVELS, { x: 0, y: 0 });
  assert.equal(c.w.coins - (ec.before.coins), 10);
  assert.equal(c.w.piles.safe, 6);
  assert.deepEqual(of(cues(ec.before, c.w, L), "pile"), [{ kind: "pile", n: 10 }]);
  assert.equal(gains(ec.before, c.w).coins, 10);
});

test("the player's own pickups sound as they did: a desk pile, the safe, and coins off the floor", () => {
  const { w } = withCollector();
  w.piles.safe = 7;
  take(w);
  shown(w);
  go(w, safe.pileAt);
  assert.deepEqual(of(take(w), "pile"), [{ kind: "pile", n: 7 }]);
  assert.equal(shown(w).coins, 7);
});
