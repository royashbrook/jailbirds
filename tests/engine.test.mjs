import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import {
  create, step, route, player, followers, boostMult, capacity, freeBeds, noBed, population, restore, hint, mood, isDone, wants, padVisible, DT, PAD_WAIT,
} from "../src/engine/sim.ts";
import { LEVELS, hintText } from "../src/content/jail.ts";

const L = LEVELS[0];
const station = (id) => L.stations.find((s) => s.id === id);
const pad = (id) => L.pads.find((p) => p.id === id);
const desk = station("desk");
const HALL = { x: 330, y: 540 };

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
    step(w, LEVELS, d < s ? { x: dx / s, y: dy / s } : { x: dx / d, y: dy / d });
    if (w.level !== 0) return;
    still = Math.hypot(p.x - was.x, p.y - was.y) < 0.01 ? still + 1 : 0;
    if (still > 30) assert.fail(`stuck at ${p.x.toFixed(0)},${p.y.toFixed(0)} on the way to ${to.x},${to.y}`);
  }
  assert.fail(`never reached ${to.x},${to.y}`);
}
const wait = (w, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) step(w, LEVELS, { x: 0, y: 0 });
};
const until = (w, done, seconds, what) => {
  for (let i = 0; i < seconds * 60; i++) {
    if (done()) return;
    step(w, LEVELS, { x: 0, y: 0 });
  }
  assert.fail(`waited ${seconds}s for ${what}`);
};
const inmates = (w) => w.agents.filter((a) => a.kind === "agent");
const count = (w, state) => inmates(w).filter((a) => a.state === state).length;
const say = (w) => hintText(hint(w, L), "birds");
const line = (w) => followers(w, player(w));
/** to a cell's door from below, clear of the other doors: the player's line moves in at the
 * first door with a free bed it passes, so the way there must not pass one */
function toCell(w, id) {
  const at = station(id).at;
  go(w, { x: at.x, y: at.y + 46 });
  go(w, at);
}

/** check in the first busload, lead them to cells 1 and 2 */
function settle(seed = 7) {
  const w = create(LEVELS, 0, seed);
  until(w, () => count(w, "queue") === 3 && inmates(w).every((a) => a.state !== "arrive"), 20, "the first bus to queue up");
  go(w, desk.at);
  until(w, () => count(w, "ready") === 3, 5, "three check-ins");
  // standing still by them takes them one at a time
  go(w, desk.out[1]);
  until(w, () => line(w).length === 2, 2, "two to join");
  toCell(w, "c0");
  wait(w, 1);
  go(w, desk.out[2]);
  until(w, () => line(w).length === 1, 1, "the third to join");
  go(w, station("c1").at);
  wait(w, 0.6);
  const first = inmates(w).filter((a) => a.house);
  assert.equal(first.length, 3);
  // as if they had been looked after: full up, and anyone who tagged along goes back in
  for (const b of first) for (const n of L.needs) b.needs[n.id] = 1;
  go(w, station("c0").at);
  go(w, station("c1").at);
  go(w, HALL);
  until(w, () => first.every((b) => b.state === "home"), 15, "everyone in bed");
  return { w, first };
}
/** lead whoever waits at a cell door to the canteen and see them fed */
function feed(w, cells) {
  go(w, station("stove").at);
  until(w, () => player(w).carry === w.carryMax, 3, "a full stack");
  go(w, station("table1").at);
  until(w, () => player(w).carry === 0, 3, "the trays to go down");
  for (const c of cells) {
    go(w, station(c).at);
    // a hold for each one waiting there
    wait(w, 1.3);
    go(w, station("table1").at);
    wait(w, 0.5);
  }
}

test("the words say money, never coins", () => {
  assert.equal(hintText({ key: "coins" }, "birds"), "walk over the money to pick it up");
  const keys = ["alert", "checkin", "nobed", "pickup", "house", "release", "done", "errand", "fetch", "drop", "clean", "coins", "pad", "rank", "idle"];
  for (const key of keys) assert.doesNotMatch(hintText({ key, need: "food" }, "birds"), /coin/i, key);
});

test("the loop: bus, gate, queue, check-in, line, cells, a need led to its room, coins, a pad", () => {
  const w = create(LEVELS, 0, 1);
  assert.equal(capacity(w, L), 4);
  until(w, () => count(w, "queue") === 3 && inmates(w).every((a) => a.state !== "arrive"), 20, "the first bus to queue up");
  // they came off the bus through the gate on their own, and stand in line at the desk
  const q = inmates(w);
  assert.ok(q.every((a) => a.tags.length === 0 && a.y > desk.prop.y), "queued below the desk, not yet checked in");
  assert.equal(say(w), "stand behind the intake desk to check them in");
  wait(w, 3);
  assert.equal(count(w, "ready"), 0, "nobody at the desk, nobody checked in");

  go(w, desk.at);
  until(w, () => count(w, "ready") === 3, 5, "three check-ins");
  assert.ok(q.every((a) => a.tags.includes("uniform")));
  assert.equal(w.piles.desk, 3 * desk.pay, "each check-in pays into the desk's pile");
  assert.equal(say(w), "walk up to the checked-in birds to lead them");

  // the line holds two at the start; the third waits. walking up takes nobody: standing
  // still by them takes them, one after the other
  go(w, desk.out[1]);
  assert.equal(line(w).length, 0, "nobody joins at a walk");
  until(w, () => line(w).length === 2, 2, "two to join");
  wait(w, 1);
  assert.equal(line(w).length, 2);
  assert.equal(w.lineMax, 2);
  toCell(w, "c0");
  wait(w, 1);
  assert.equal(line(w).length, 0, "two beds in a cell, two in");
  go(w, desk.out[2]);
  until(w, () => line(w).length === 1, 1, "the third to join");
  go(w, station("c1").at);
  wait(w, 0.6);
  go(w, HALL);
  assert.ok(q.every((b) => ["c0", "c1"].includes(b.house)));
  assert.ok(["c0", "c1"].every((c) => q.filter((b) => b.house === c).length <= 2), "two beds a cell");
  for (const b of q.filter((b) => b.state === "home")) {
    const r = L.rooms.find((x) => x.id === b.house).rect;
    assert.ok(b.x > r.x && b.x < r.x + r.w && b.y > r.y && b.y < r.y + r.h, `${b.house} ${b.x},${b.y}`);
  }

  // content at first: coins by the door
  until(w, () => w.floor.length > 0, 10, "a first coin");
  // soon hungry: they wait at home with a bubble, and drop nothing more
  until(w, () => q.every((b) => mood(L, b) === "needy"), 30, "everyone hungry");
  const floor = w.floor.length;
  wait(w, 5);
  assert.ok(q.every((b) => b.state === "home" || b.state === "follow"), "nobody walks to the canteen alone");
  assert.equal(w.floor.length, floor);
  // the next bus waits at the desk, so the hint names the hungry once one of them is in line
  go(w, station("c0").at);
  until(w, () => line(w).length === 1, 1, "a hungry one to join");
  assert.equal(say(w), "hungry birds! walk them to the canteen");

  // trays out, then lead them in: they sit and eat and walk home by themselves
  feed(w, ["c0", "c1"]);
  // they were all under the threshold a moment ago: over half full means each one ate
  until(w, () => q.every((b) => b.needs.food > 0.5), 30, "everyone to eat");
  assert.equal(w.stock.table1, 0);

  // fed and content: coins by the cells; walking over them banks them
  // fed and content: coins by the cells and the desk's pile; walking over them banks them
  go(w, desk.pileAt);
  assert.equal(w.piles.desk, 0, "the pile walked over");
  go(w, station("c0").at);
  go(w, station("c1").at);
  const banked = w.coins;
  assert.ok(banked >= 3 * desk.pay + floor, `coins ${banked}`);
  // a shower bubble: lead them to the showers, they wash and walk home. standing still for each
  // pickup takes a while, so give them their time back: someone done goes to release, not the showers
  for (const b of q) b.served = 0;
  go(w, HALL);
  until(w, () => q.some((b) => b.state === "home" && wants(L, b, true) === "wash" && b.rest > 2), 90, "someone wanting a shower");
  const smelly = q.find((b) => wants(L, b, true) === "wash");
  go(w, station(smelly.house).at);
  wait(w, 1.3);
  // whoever else waited at that door joined too, one hold each, up to the line's size
  const led = line(w).filter((b) => wants(L, b, true) === "wash");
  assert.ok(led.length > 0);
  assert.equal(say(w), "smelly birds! walk them to the showers");
  // the wrong room does nothing: through the canteen, nobody who wants a shower sits down
  w.stock.table1 = 3;
  go(w, station("table1").at);
  wait(w, 0.5);
  assert.ok(led.every((b) => b.state === "follow"), "a shower bubble is not a meal");
  go(w, { x: 600, y: 470 });
  wait(w, 0.5);
  assert.equal(led[0].station, "showers");
  until(w, () => led[0].needs.wash > 0.99, 10, "a shower");
  // content again: coins. the holds made this a longer day, long enough for the toilets to get
  // messy and everyone to run low, so see to the rest of their needs as if it were done
  for (const b of q) for (const n of L.needs) b.needs[n.id] = 1;
  w.messes = [];
  until(w, () => w.floor.length >= 1, 30, "new coins on the floor");
  for (const c of new Set(w.floor.map((x) => x.house))) go(w, station(c).at);
  assert.ok(w.coins > banked, "more coins banked");

  // a price tag drinks its cost over about a second
  // counted once there: content residents keep dropping coins, and the way over may cross one
  const cell3 = pad("cell3");
  go(w, cell3.at);
  const had = w.coins;
  wait(w, 0.4);
  assert.ok(!w.bought.includes("cell3"), "not paid yet");
  wait(w, 1);
  assert.ok(w.bought.includes("cell3"));
  assert.equal(w.coins, had - cell3.cost);
  assert.equal(capacity(w, L), 6);
});

test("no bed: the desk stops checking in until a cell is bought", () => {
  const { w } = settle();
  // the second bus: one bed left for three
  until(w, () => count(w, "queue") === 3, 20, "the next bus");
  go(w, desk.at);
  until(w, () => count(w, "ready") === 1, 5, "the last bed's check-in");
  wait(w, 3);
  assert.equal(count(w, "ready"), 1, "no more check-ins with every bed promised");
  assert.equal(freeBeds(w, L), 0);
  assert.ok(noBed(w, L));
  assert.equal(say(w), "no free beds! unlock another cell");
  w.coins = 50;
  go(w, pad("cell3").at);
  wait(w, 1.5);
  go(w, desk.at);
  until(w, () => count(w, "ready") === 3, 5, "check-ins again");
});

test("served their time: led to the release desk, a star, a pile, a level up with a reward", () => {
  const { w, first } = settle();
  for (const b of first) b.served = L.serve;
  wait(w, 0.1);
  assert.ok(first.every((b) => isDone(L, b)));
  go(w, station("c0").at);
  until(w, () => line(w).length === 2, 2, "both to join");
  assert.equal(say(w), "lead them to the release desk to set them free");
  w.coins = 0; // nothing for a price tag on the way to drink
  go(w, station("stamp").at);
  wait(w, 1.5);
  assert.equal(w.released, 2);
  // rank 1 needs two stars: the second one levels up and pays the reward
  assert.equal(w.rank, 2);
  assert.equal(w.stars, 0);
  assert.ok(w.coins >= L.rankReward * 2, `the level-up reward, coins ${w.coins}`);
  assert.equal(w.piles.stamp, 2 * station("stamp").pay);
  // they walk out (by the stamp at the desk first) and are gone, and their beds are free
  const gone = first.filter((b) => b.state === "stamp" || b.state === "leave");
  assert.equal(gone.length, 2);
  until(w, () => gone.every((b) => !w.agents.includes(b)), 20, "the released to leave");
  assert.equal(freeBeds(w, L) >= 3, true);
});

test("someone on the way to release stays in line through the canteen, even when hungry", () => {
  const { w, first } = settle();
  const food = station("table1").need;
  for (const b of first) (b.served = L.serve), (b.needs[food] = 0.05);
  wait(w, 0.1);
  go(w, station("c0").at);
  until(w, () => line(w).length === 2, 2, "both to join");
  const leaving = line(w);
  assert.equal(leaving.length, 2);
  assert.ok(leaving.every((b) => isDone(L, b) && wants(L, b, true) === food), "done, and hungry too");
  go(w, station("table1").at);
  wait(w, 1);
  assert.equal(line(w).length, 2, "nobody sat down to eat");
  assert.ok(leaving.every((b) => b.state === "follow"));
  w.coins = 0;
  go(w, station("stamp").at);
  wait(w, 1.5);
  assert.equal(w.released, 2);
});

test("walking over a pad takes nothing, at a walk or on skates; stopping on it a moment buys it", () => {
  for (const boosted of [0, 30]) {
    const w = create(LEVELS, 0, 7), p = player(w), cell3 = pad("cell3");
    w.coins = 50;
    w.boosted = boosted;
    // from well left of it to well right of it, straight through the middle
    p.x = cell3.at.x - 60;
    p.y = cell3.at.y;
    let over = 0;
    for (let i = 0; i < 240 && p.x < cell3.at.x + 60; i++) {
      step(w, LEVELS, { x: 1, y: 0 });
      if (Math.abs(p.x - cell3.at.x) < 24) over++;
    }
    assert.ok(p.x >= cell3.at.x + 60, `walked through, stopped at ${p.x}`);
    assert.ok(over > 3, `on the pad for ${over} steps`);
    assert.equal(w.coins, 50, "not a coin taken");
    assert.equal(w.paid.cell3 ?? 0, 0);
    // back onto it and stand there
    p.x = cell3.at.x;
    wait(w, PAD_WAIT - 0.05);
    assert.equal(w.coins, 50, "a moment's grace before it starts");
    wait(w, 1.5);
    assert.ok(w.bought.includes("cell3"), "standing there buys it");
    assert.equal(w.coins, 50 - cell3.cost);
  }
});

test("moving off again on a pad stops it taking coins at once, and stopping again waits again", () => {
  const w = create(LEVELS, 0, 7), p = player(w), cell3 = pad("cell3");
  w.coins = 50;
  p.x = cell3.at.x - 10;
  p.y = cell3.at.y;
  // stood past the wait, right up to where one more step standing would take the first coin
  const rate = Math.max(4, cell3.cost) * DT;
  for (let i = 0; i < 120 && !((w.clock.pad ?? 0) + rate >= 1); i++) step(w, LEVELS, { x: 0, y: 0 });
  assert.equal(w.coins, 50);
  assert.ok(w.clock.still >= PAD_WAIT && w.clock.pad + rate >= 1, "on the edge of paying");
  // a step along the pad: still on it, moving, and not a coin
  for (let i = 0; i < 6; i++) step(w, LEVELS, { x: 1, y: 0 });
  assert.ok(Math.abs(p.x - cell3.at.x) < 24, "still on the pad");
  assert.equal(w.coins, 50, "moving takes nothing, even with the wait already done");
  assert.equal(w.paid.cell3 ?? 0, 0);
  // stopping again starts the wait over
  wait(w, PAD_WAIT - 0.05);
  assert.equal(w.coins, 50, "a fresh wait after moving");
  wait(w, 1.5);
  assert.ok(w.bought.includes("cell3"));
});

test("level-locked pads wait for the rank; upgrades change speed and the line", () => {
  const { w } = settle();
  w.coins = 500;
  go(w, pad("speed1").at);
  wait(w, 2);
  assert.ok(!w.bought.includes("speed1"), "rank 2 pad at rank 1");
  assert.equal(w.paid.speed1 ?? 0, 0);
  go(w, pad("line1").at);
  wait(w, 1.5);
  assert.equal(w.lineMax, 3);
  w.rank = 2;
  go(w, pad("speed1").at);
  wait(w, 1.5);
  assert.equal(w.speed, 112);
  // and the next in the chain shows only now
  assert.ok(L.pads.find((p) => p.id === "speed2").after === "speed1");
});

test("toilets in the cells make a mess that blocks the toilet until someone walks in and cleans it", () => {
  const { w, first } = settle(11);
  until(w, () => w.messes.some((m) => m.kind === "poop"), 240, "a messy toilet");
  const mess = w.messes.find((m) => m.kind === "poop");
  const cell = L.rooms.find((r) => r.id === station("toilets").seats[mess.seat].house).rect;
  assert.ok(mess.x > cell.x && mess.x < cell.x + cell.w && mess.y > cell.y && mess.y < cell.y + cell.h, "the mess is in the cell");
  // that toilet is off limits while the mess is there
  const owner = first.find((b) => b.house === station("toilets").seats[mess.seat].house);
  for (const n of L.needs) owner.needs[n.id] = 1;
  owner.needs.toilet = 0.1;
  wait(w, 2);
  assert.notEqual(owner.state, "go");
  go(w, mess);
  wait(w, 0.5);
  assert.ok(!w.messes.includes(mess), "walked in, cleaned up");
  until(w, () => owner.station === "toilets", 3, "the toilet in use again");
});

test("a squabble raises a high alert; standing there settles it and pays", () => {
  const { w } = settle();
  w.coins = 50;
  go(w, pad("cell3").at);
  wait(w, 1.5);
  until(w, () => count(w, "queue") > 0, 20, "the next bus");
  go(w, desk.at);
  until(w, () => count(w, "ready") === 3, 5, "check-ins");
  go(w, desk.out[2]);
  until(w, () => line(w).length === 1, 1, "one to join");
  go(w, station("c1").at);
  wait(w, 0.6);
  go(w, desk.out[0]);
  until(w, () => line(w).length === 1, 1, "one more to join");
  go(w, station("c2").at);
  until(w, () => count(w, "home") >= 4, 15, "four at home");
  w.fightIn = 0;
  wait(w, 0.1);
  assert.ok(w.alert, "a high alert");
  assert.equal(count(w, "fight"), 2);
  assert.equal(say(w), "uh oh, a squabble! run over and calm it down");
  const cash = w.coins + w.floor.length;
  // it waits for the warden to come
  wait(w, L.fights.settle + 1);
  assert.ok(w.alert, "nobody there, still squabbling");
  go(w, w.alert);
  wait(w, L.fights.settle + 0.2);
  assert.equal(w.alert, null);
  assert.equal(w.settled, 1);
  assert.equal(count(w, "fight"), 0);
  assert.ok(w.coins + w.floor.length >= cash + L.fights.reward, "the reward, under foot or in the pocket");
});

test("a free speed boost turns up; walking over it makes the warden faster for a while", () => {
  const w = create(LEVELS, 0, 3);
  w.boost.t = 0;
  wait(w, 0.1);
  assert.ok(w.boost.here);
  w.boostKind = "skates";
  go(w, w.boost);
  assert.ok(w.boosted > 0);
  assert.equal(w.mountKind, "skates");
  const p = player(w), x = p.x;
  step(w, LEVELS, { x: 1, y: 0 });
  assert.ok(Math.abs(p.x - x - w.speed * L.boost.kinds.skates.mult * DT) < 0.01 || p.x < x + 1, "boosted step");
  wait(w, L.boost.kinds.skates.time + 0.5);
  assert.equal(w.boosted, 0);
});

test("hired help does the chores: clerk checks in, guard leads, cook carries trays", () => {
  const { w, first } = settle();
  w.coins = 500;
  w.rank = 4;
  go(w, pad("cell3").at);
  wait(w, 1.5);
  for (const id of ["cook", "guard", "clerk"]) {
    go(w, pad(id).at);
    wait(w, 1.5);
  }
  assert.deepEqual(w.agents.filter((a) => !["agent", "player"].includes(a.kind)).map((a) => a.kind).sort(), ["carrier", "clerk", "escort"]);
  // hands off from here: watch one stretch of play with the player standing still
  go(w, HALL);
  const housed = inmates(w).filter((a) => a.house).length;
  const saw = { housed: false, trays: false, led: false, released: false };
  const stock = () => (w.stock.table1 ?? 0) + (w.stock.table2 ?? 0);
  let trays = stock();
  for (let i = 0; i < 60 * 240 && !Object.values(saw).every(Boolean); i++) {
    step(w, LEVELS, { x: 0, y: 0 });
    if (inmates(w).filter((a) => a.house).length >= housed + 2) saw.housed = true;
    if (stock() > trays) saw.trays = true;
    trays = stock();
    if (inmates(w).some((b) => b.station === "table1" && b.state === "go")) saw.led = true;
    if (w.released > 0) saw.released = true;
  }
  assert.deepEqual(saw, { housed: true, trays: true, led: true, released: true }, "clerk checks in, guard houses, cook carries, guard leads to eat and to release");
  assert.ok(Math.hypot(player(w).x - HALL.x, player(w).y - HALL.y) < 2, "the player never moved");
});

test("more guards: a second at level 5 and a third at level 6, each on the same spot after the last", () => {
  const w = create(LEVELS, 0, 7);
  const vis = (id) => padVisible(w, pad(id));
  assert.deepEqual([pad("guard2").at, pad("guard3").at], [pad("guard").at, pad("guard").at]);
  assert.deepEqual([vis("guard"), vis("guard2"), vis("guard3")], [true, false, false]);
  w.bought.push("guard");
  assert.deepEqual([vis("guard2"), vis("guard3")], [true, false]);
  w.bought.push("guard2");
  assert.equal(vis("guard3"), true);
  // a level too low takes nothing; each one bought is one more guard
  const v = create(LEVELS, 0, 7);
  v.coins = 1000;
  v.rank = 4;
  v.bought.push("guard");
  go(v, pad("guard2").at);
  wait(v, 1.5);
  assert.equal(v.paid.guard2 ?? 0, 0, "guard2 waits for level 5");
  v.rank = 6;
  wait(v, 3);
  assert.ok(v.bought.includes("guard2") && v.bought.includes("guard3"));
  assert.equal(v.agents.filter((a) => a.kind === "escort").length, 2, "two new guards");
});

test("guards with nobody in line go for different people, not all for the same one", () => {
  const { w } = settle();
  // three guards, two newcomers checked in and standing still, waiting to be led
  w.coins = 1000;
  w.rank = 6;
  go(w, pad("guard").at);
  until(w, () => w.bought.includes("guard3"), 6, "three guards bought");
  const guards = w.agents.filter((a) => a.kind === "escort");
  assert.equal(guards.length, 3);
  // beds for the newcomers
  go(w, pad("cell3").at);
  wait(w, 1.5);
  until(w, () => count(w, "queue") >= 2, 40, "two more in the queue");
  go(w, desk.at);
  until(w, () => count(w, "ready") >= 2, 10, "two check-ins");
  go(w, HALL);
  const ready = inmates(w).filter((a) => a.state === "ready");
  until(w, () => ready.every((b) => !b.path.length || b.state !== "ready"), 5, "the newcomers to stop");
  assert.ok(ready.slice(0, 2).every((b) => b.state === "ready"), "nobody picked them up yet");
  step(w, LEVELS, { x: 0, y: 0 });
  // each guard's path ends where it is going: the two newcomers get one guard each
  const ends = guards.map((g) => g.path.at(-1)).filter(Boolean);
  const to = (b) => ends.filter((e) => Math.hypot(e.x - b.x, e.y - b.y) < 1).length;
  assert.deepEqual(ready.slice(0, 2).map(to), [1, 1], "one guard each");
});

test("guards fetching residents from their doors split up between the doors", () => {
  const { w, first } = settle();
  w.coins = 1000;
  w.rank = 6;
  go(w, pad("guard").at);
  until(w, () => w.bought.includes("guard3"), 6, "three guards bought");
  go(w, HALL);
  const guards = w.agents.filter((a) => a.kind === "escort");
  // everyone at home wants a wash, in both cells
  for (const b of first) b.needs.wash = 0.05;
  until(w, () => first.every((b) => b.state === "home" && b.rest >= 2), 5, "residents settled at their doors");
  const doors = [...new Set(first.map((b) => b.house))].map((id) => station(id).at);
  assert.equal(doors.length, 2);
  for (const g of guards) g.path = [];
  step(w, LEVELS, { x: 0, y: 0 });
  const ends = guards.map((g) => g.path.at(-1)).filter(Boolean);
  assert.deepEqual(doors.map((d) => ends.filter((e) => Math.hypot(e.x - d.x, e.y - d.y) < 1).length), [1, 1], "one guard per door");
});

test("in both jails the guard pads are one chain on one spot, one at a time, in order", () => {
  for (const [n, lv] of LEVELS.entries()) {
    const [g1, g2, g3] = ["guard", "guard2", "guard3"].map((id) => lv.pads.find((p) => p.id === id));
    assert.deepEqual([g1.rank, g2.rank, g3.rank, g2.after, g3.after], [3, 5, 6, "guard", "guard2"], `jail ${n + 1}`);
    assert.deepEqual([g2.at, g3.at], [g1.at, g1.at]);
    assert.deepEqual([g1, g2, g3].map((p) => p.unlock), [{ helper: "escort" }, { helper: "escort" }, { helper: "escort" }]);
    const w = create(LEVELS, n, 7);
    const shown = () => [g1, g2, g3].filter((p) => padVisible(w, p)).map((p) => p.id);
    assert.deepEqual(shown(), ["guard"]);
    w.bought.push("guard");
    assert.deepEqual(shown(), ["guard2"]);
    w.bought.push("guard2");
    assert.deepEqual(shown(), ["guard3"]);
    w.bought.push("guard3");
    assert.deepEqual(shown(), []);
  }
});

/** a settled jail with all three guards bought by standing on the pad */
function guarded() {
  const s = settle();
  s.w.coins = 1000;
  s.w.rank = 6;
  go(s.w, pad("guard").at);
  until(s.w, () => s.w.bought.includes("guard3"), 6, "three guards bought");
  return s;
}

test("a save keeps its guards; an old one-guard save gets no extra guards from the new pads", () => {
  const { w } = guarded();
  const back = restore(JSON.stringify(w), LEVELS);
  assert.equal(back.agents.filter((a) => a.kind === "escort").length, 3);
  assert.deepEqual(back.bought, w.bought);
  assert.deepEqual(back.paid, w.paid);
  // an older jail with the one guard there used to be
  const one = settle().w;
  one.coins = 1000;
  one.rank = 4;
  go(one, pad("guard").at);
  until(one, () => one.bought.includes("guard"), 3, "the first guard");
  go(one, HALL);
  const old = restore(JSON.stringify(one), LEVELS);
  assert.equal(old.agents.filter((a) => a.kind === "escort").length, 1);
  assert.ok(!old.bought.includes("guard2"));
  assert.ok(padVisible(old, pad("guard2")), "the next guard is on offer, not given");
});

test("three guards working at once all lead people, and the jail keeps moving", () => {
  const { w } = guarded();
  // beds, a clerk to check people in and a cook for the trays, so there is work for three
  for (const id of ["cell3", "cell4", "clerk", "cook"]) {
    go(w, pad(id).at);
    until(w, () => w.bought.includes(id), 4, id);
  }
  go(w, HALL);
  const guards = w.agents.filter((a) => a.kind === "escort");
  const led = new Set();
  const housed0 = inmates(w).filter((a) => a.house).length;
  for (let i = 0; i < 60 * 180; i++) {
    step(w, LEVELS, { x: 0, y: 0 });
    for (const b of inmates(w)) if (b.state === "follow" && b.leader !== player(w).id) led.add(b.leader);
  }
  assert.equal(guards.filter((g) => led.has(g.id)).length, 3, "every guard led somebody");
  assert.ok(inmates(w).filter((a) => a.house).length > housed0, "more people moved in");
  assert.ok(w.released > 0, "and some served their time and went home");
});

test("idle helpers stand apart around their spot, not on top of each other", () => {
  const { w } = guarded();
  // nothing for anyone to do: everyone at home is full up, nobody waits at the desk
  for (const b of inmates(w)) for (const n of L.needs) b.needs[n.id] = 1;
  w.agents = w.agents.filter((a) => a.kind !== "agent" || a.house);
  w.ride.t = 9999;
  go(w, HALL);
  wait(w, 8);
  const guards = w.agents.filter((a) => a.kind === "escort");
  for (let i = 0; i < guards.length; i++)
    for (let j = i + 1; j < guards.length; j++)
      assert.ok(Math.hypot(guards[i].x - guards[j].x, guards[i].y - guards[j].y) >= 12, `guards ${i} and ${j} apart`);
});

test("level 6 and the next jail pad moves on to jail 2", () => {
  const { w } = settle();
  w.coins = 500;
  w.rank = 6;
  go(w, pad("next").at);
  wait(w, 2);
  assert.equal(w.level, 1);
  assert.equal(population(w), 0);
  assert.equal(w.agents.length, 1);
  assert.ok(LEVELS[1].pads.every((p) => p.unlock.level !== true), "jail 2 is the last for now");
});

test("same seed, same stick, same game", () => {
  const play = () => {
    const w = create(LEVELS, 0, 42);
    for (let i = 0; i < 60 * 40; i++) step(w, LEVELS, { x: Math.sin(i / 90), y: Math.cos(i / 70) });
    return JSON.stringify(w);
  };
  assert.equal(play(), play());
});

test("a saved game comes back as it was; junk and old saves come back as nothing", () => {
  const { w } = settle();
  const back = restore(JSON.stringify(w), LEVELS);
  assert.equal(back.coins, w.coins);
  assert.equal(back.agents.length, w.agents.length);
  assert.deepEqual(back.piles, w.piles);
  assert.equal(restore(null, LEVELS), null);
  assert.equal(restore("{not json", LEVELS), null);
  assert.equal(restore(JSON.stringify({ ...w, v: 2 }), LEVELS), null);
  assert.equal(restore(JSON.stringify({ ...w, level: 9 }), LEVELS), null);
  assert.equal(restore(JSON.stringify({ ...w, agents: "x" }), LEVELS), null);
});

test("the engine knows nothing of jails or skins: content and drawing live outside it", async () => {
  const dir = new URL("../src/engine/", import.meta.url);
  for (const f of await readdir(dir)) {
    const src = await readFile(new URL(f, dir), "utf8");
    assert.doesNotMatch(src, /from "\.\.\/(content|skins|render)/, `${f} imports content or drawing`);
    assert.doesNotMatch(src, /canvas|document|window|localStorage|Math\.random/, `${f} touches the page or real randomness`);
    assert.doesNotMatch(src, /jail|bird|toilet|tray|\bcells?\b|kitchen|canteen|uniform|warden|inmate|poop|puddle|\bbus\b/i, `${f} uses a jail word`);
  }
});
