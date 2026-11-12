import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import {
  create, step, route, player, followers, capacity, freeBeds, noBed, population, restore, hint, mood, isDone, wants, DT, PAD_WAIT,
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
    const s = w.speed * (w.boosted > 0 ? L.boost.mult : 1) * DT, was = { x: p.x, y: p.y };
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

/** check in the first busload, lead them to cells 1 and 2 */
function settle(seed = 7) {
  const w = create(LEVELS, 0, seed);
  until(w, () => count(w, "queue") === 3 && inmates(w).every((a) => a.state !== "arrive"), 20, "the first bus to queue up");
  go(w, desk.at);
  until(w, () => count(w, "ready") === 3, 5, "three check-ins");
  go(w, desk.out[1]);
  assert.equal(line(w).length, 2);
  go(w, station("c0").at);
  wait(w, 1);
  go(w, desk.out[2]);
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
    wait(w, 0.3);
    go(w, station("table1").at);
    wait(w, 0.5);
  }
}

test("the loop: bus, gate, queue, check-in, line, cells, a need led to its room, coins, a pad", () => {
  const w = create(LEVELS, 0, 7);
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

  // the line holds two at the start; the third waits
  go(w, desk.out[1]);
  assert.equal(line(w).length, 2);
  assert.equal(w.lineMax, 2);
  go(w, station("c0").at);
  wait(w, 1);
  assert.equal(line(w).length, 0, "two beds in a cell, two in");
  go(w, desk.out[2]);
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
  // a shower bubble: lead them to the showers, they wash and walk home
  go(w, HALL);
  until(w, () => q.some((b) => b.state === "home" && wants(L, b, true) === "wash" && b.rest > 2), 90, "someone wanting a shower");
  const smelly = q.find((b) => wants(L, b, true) === "wash");
  assert.equal(say(w), "smelly birds! walk them to the showers");
  go(w, station(smelly.house).at);
  wait(w, 0.3);
  // whoever wanted a shower on the way joined too, up to the line's size
  const led = line(w).filter((b) => wants(L, b, true) === "wash");
  assert.ok(led.length > 0);
  // the wrong room does nothing: through the canteen, nobody who wants a shower sits down
  w.stock.table1 = 3;
  go(w, station("table1").at);
  wait(w, 0.5);
  assert.ok(led.every((b) => b.state === "follow"), "a shower bubble is not a meal");
  go(w, { x: 600, y: 470 });
  wait(w, 0.5);
  assert.equal(led[0].station, "showers");
  until(w, () => led[0].needs.wash > 0.99, 10, "a shower");
  // content again: coins
  until(w, () => w.floor.length >= 1, 30, "new coins on the floor");
  for (const c of new Set(w.floor.map((x) => x.house))) go(w, station(c).at);
  assert.ok(w.coins > banked, "more coins banked");

  // a price tag drinks its cost over about a second
  const had = w.coins, cell3 = pad("cell3");
  go(w, cell3.at);
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
  assert.equal(line(w).length, 2);
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
  // they walk out and are gone, and their beds are free
  const gone = first.filter((b) => b.state === "leave");
  assert.equal(gone.length, 2);
  until(w, () => gone.every((b) => !w.agents.includes(b)), 20, "the released to leave");
  assert.equal(freeBeds(w, L) >= 3, true);
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
  go(w, station("c1").at);
  wait(w, 0.6);
  go(w, desk.out[0]);
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
  go(w, w.boost);
  assert.ok(w.boosted > 0);
  const p = player(w), x = p.x;
  step(w, LEVELS, { x: 1, y: 0 });
  assert.ok(Math.abs(p.x - x - w.speed * L.boost.mult * DT) < 0.01 || p.x < x + 1, "boosted step");
  wait(w, L.boost.time + 0.5);
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
