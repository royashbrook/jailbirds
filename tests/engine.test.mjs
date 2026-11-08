import { test } from "node:test";
import assert from "node:assert/strict";
import { create, step, route, player, followers, stars, capacity, population, restore, hint, mood, DT, PLAYER_SPEED } from "../src/engine/sim.ts";
import { LEVELS, hintText } from "../src/content/jail.ts";

const L = LEVELS[0];
const station = (id) => L.stations.find((s) => s.id === id);
const pad = (id) => L.pads.find((p) => p.id === id);
const HALL = { x: 380, y: 700 };

// drive the player like a thumb would: full stick along the way round the walls
function go(w, to, cap = 60 * 30) {
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
    const s = PLAYER_SPEED * DT, was = { x: p.x, y: p.y };
    step(w, LEVELS, d < s ? { x: dx / s, y: dy / s } : { x: dx / d, y: dy / d });
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

/** play the opening: three off the bus, shirted, housed, fed */
function opening(seed = 7) {
  const w = create(LEVELS, 0, seed);
  until(w, () => count(w, "wait") === 3, 10, "the bus");
  go(w, station("bus").wait[1]);
  const first = inmates(w).slice(0, 3);
  go(w, station("desk").at);
  wait(w, 1.2);
  go(w, station("c0").at);
  wait(w, 1);
  go(w, station("c1").at);
  wait(w, 0.6);
  until(w, () => first.every((b) => b.state === "home"), 10, "everyone to sit down");
  go(w, station("stove").at);
  until(w, () => player(w).carry === w.carryMax, 3, "a full stack");
  go(w, station("table1").at);
  until(w, () => player(w).carry === 0, 3, "the trays to go down");
  until(w, () => first.every((b) => b.needs.food > 0.9 && b.state === "home"), 30, "everyone to eat and go home");
  return { w, first };
}

test("the loop: bus, follow, intake, cells, food, coins, a price pad", () => {
  const w = create(LEVELS, 0, 7);
  assert.equal(capacity(w, L), 4);
  until(w, () => count(w, "wait") === 3, 10, "the bus");
  assert.equal(hintText(hint(w, L), "birds"), "walk to the birds at the bus stop");

  go(w, station("bus").wait[1]);
  const line = followers(w, player(w));
  assert.equal(line.length, 3);
  const first = inmates(w).slice(0, 3);

  // no shirt, no cell (round the intake, not through it past the desk)
  go(w, HALL);
  go(w, station("c1").at);
  wait(w, 1);
  assert.equal(followers(w, player(w)).length, 3, "no shirt, no cell");
  assert.ok(first.every((b) => b.tags.length === 0));

  // followers walk the leader's trail through the doors: none is ever inside a wall
  go(w, station("desk").at);
  wait(w, 1.2);
  assert.ok(first.every((b) => b.tags.includes("uniform")));

  go(w, station("c0").at);
  wait(w, 1);
  go(w, station("c1").at);
  wait(w, 0.6);
  assert.equal(followers(w, player(w)).length, 0);
  until(w, () => first.every((b) => b.state === "home"), 10, "everyone to sit down");
  assert.deepEqual(first.map((b) => b.house).sort(), ["c0", "c0", "c1"]);
  // they walked in through the cell doors, so each ended inside its own cell
  for (const b of first) {
    const r = L.rooms.find((x) => x.id === b.house).rect;
    assert.ok(b.x > r.x && b.x < r.x + r.w && b.y > r.y && b.y < r.y + r.h, `${b.house} ${b.x},${b.y}`);
  }

  // they come in hungry, and a hungry one drops no coins
  assert.ok(first.every((b) => mood(L, b) === "needy"));
  wait(w, 5);
  assert.equal(w.floor.length, 0);
  assert.equal(hintText(hint(w, L), "birds"), "hungry birds! grab trays in the kitchen");

  // trays from the kitchen to a table, and they go and eat
  go(w, station("stove").at);
  until(w, () => player(w).carry === w.carryMax, 3, "a full stack");
  wait(w, 1);
  assert.equal(player(w).carry, w.carryMax, "the stack stops at the cap");
  go(w, station("table1").at);
  until(w, () => player(w).carry === 0, 3, "the trays to go down");
  assert.equal(w.stock.table1, 4);
  until(w, () => first.every((b) => b.needs.food > 0.9 && b.state === "home"), 30, "everyone to eat and go home");
  assert.equal(w.stock.table1, 1);
  assert.equal(stars(w, L), 1, "everyone content is one star");

  // content ones drop coins by their cells; walking over them banks them
  until(w, () => w.floor.length >= 8, 30, "coins on the floor");
  go(w, station("c0").at);
  go(w, station("c1").at);
  assert.ok(w.coins >= 8, `coins ${w.coins}`);

  // the third cell's price tag takes its cost over about a second, then the cell is open
  const had = w.coins, cell3 = pad("cell3");
  go(w, cell3.at);
  wait(w, 0.4);
  assert.ok(!w.bought.includes("cell3"), "not paid yet");
  wait(w, 1);
  assert.ok(w.bought.includes("cell3"));
  assert.equal(w.coins, had - cell3.cost);
  assert.equal(capacity(w, L), 6);
  assert.equal(w.points, 0.5);
});

test("a washroom makes a mess that blocks it until it is cleaned", () => {
  const { w, first } = opening();
  // the toilet need comes round; one goes, and leaves a mess on the only toilet
  until(w, () => w.messes.some((m) => m.kind === "poop"), 90, "a trip to the toilet");
  const mess = w.messes.find((m) => m.kind === "poop");
  // while it is there, a bird who needs the toilet waits at home
  until(w, () => first.some((b) => b.needs.toilet < L.threshold && b.state === "home"), 90, "a second bird to need the toilet");
  wait(w, 2);
  assert.ok(first.every((b) => !(b.state === "go" && b.station === "toilets")), "the dirty toilet is off limits");
  go(w, mess);
  wait(w, 0.5);
  assert.ok(!w.messes.includes(mess), "walked over, cleaned up");
  until(w, () => first.some((b) => b.station === "toilets"), 5, "the toilet in use again");
});

test("ignored, they get cross, the stars fall, and a pad wants more stars", () => {
  const { w, first } = opening();
  w.coins = 500;
  // table2 wants two stars; with one it takes nothing
  go(w, pad("table2").at);
  wait(w, 3);
  assert.equal(w.paid.table2 ?? 0, 0);
  assert.ok(!w.bought.includes("table2"));
  // walk off and leave them be: food runs out, they turn cross, no stars
  go(w, HALL);
  until(w, () => first.every((b) => mood(L, b) === "cross"), 200, "everyone cross");
  assert.equal(stars(w, L), 0);
  const coins = w.floor.length;
  wait(w, 10);
  assert.equal(w.floor.length, coins, "cross ones drop no coins");
});

test("hired help does the chores: a cook, a cleaner, a guard", () => {
  const { w } = opening();
  w.coins = 500;
  w.points = 3; // as if the rest of the jail were already bought
  go(w, pad("cook").at);
  wait(w, 1.5);
  go(w, pad("cleaner").at);
  wait(w, 1.5);
  go(w, pad("guard").at);
  wait(w, 1.5);
  assert.deepEqual(w.agents.filter((a) => a.kind !== "agent" && a.kind !== "player").map((a) => a.kind).sort(), ["carrier", "cleaner", "escort"]);
  // the player stands still from here
  w.stock.table1 = 0;
  until(w, () => w.stock.table1 > 0, 30, "the cook to put trays out");
  w.messes.push({ id: 999, kind: "puddle", x: 600, y: 590, station: "showers", seat: 1, clean: 0 });
  until(w, () => !w.messes.some((m) => m.id === 999), 30, "the cleaner to mop up");
  // the guard brings the next busload in, shirted, to the empty cell
  const before = inmates(w).filter((a) => a.state === "home" || a.state === "enter").length;
  until(w, () => inmates(w).filter((a) => a.house && a.tags.includes("uniform")).length > before, 90, "the guard to house someone");
});

test("five stars and the next jail pad moves on to jail 2", () => {
  const { w } = opening();
  w.coins = 500;
  w.points = 4.5;
  until(w, () => stars(w, L) === 5, 5, "five stars");
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
    for (let i = 0; i < 60 * 30; i++) step(w, LEVELS, { x: Math.sin(i / 90), y: Math.cos(i / 70) });
    return JSON.stringify(w);
  };
  assert.equal(play(), play());
});

test("a saved game comes back as it was; junk comes back as nothing", () => {
  const { w } = opening();
  const back = restore(JSON.stringify(w), LEVELS);
  assert.equal(back.coins, w.coins);
  assert.equal(back.agents.length, w.agents.length);
  assert.deepEqual(back.stock, w.stock);
  assert.equal(restore(null, LEVELS), null);
  assert.equal(restore("{not json", LEVELS), null);
  assert.equal(restore(JSON.stringify({ ...w, v: 1 }), LEVELS), null);
  assert.equal(restore(JSON.stringify({ ...w, level: 9 }), LEVELS), null);
  assert.equal(restore(JSON.stringify({ ...w, agents: "x" }), LEVELS), null);
});

test("the engine knows nothing of jails or skins: content and drawing live outside it", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const dir = new URL("../src/engine/", import.meta.url);
  for (const f of await readdir(dir)) {
    const src = await readFile(new URL(f, dir), "utf8");
    assert.doesNotMatch(src, /from "\.\.\/(content|skins|render)/, `${f} imports content or drawing`);
    assert.doesNotMatch(src, /canvas|document|window|localStorage|Math\.random/, `${f} touches the page or real randomness`);
    assert.doesNotMatch(src, /jail|bird|toilet|tray|\bcells?\b|kitchen|canteen|uniform|warden|inmate|poop|puddle|\bbus\b/i, `${f} uses a jail word`);
  }
});
