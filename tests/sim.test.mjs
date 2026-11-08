import { test } from "node:test";
import assert from "node:assert/strict";
import { create, step, restore, hint, DT, MAX_CARRY } from "../src/lib/sim/sim.ts";
import { DESK_SPOT, KITCHEN_SPOT, STOP, cellDoor, tableCentre, PADS } from "../src/lib/sim/map.ts";

// drive the warden like a thumb would: full stick toward a point until there
function walkTo(w, to, cap = 60 * 20) {
  for (let i = 0; i < cap; i++) {
    const dx = to.x - w.warden.x, dy = to.y - w.warden.y, d = Math.hypot(dx, dy);
    if (d < 2) return;
    step(w, d < 2 + 120 * DT ? { x: dx / (120 * DT), y: dy / (120 * DT) } : { x: dx / d, y: dy / d });
  }
  assert.fail(`never reached ${JSON.stringify(to)}`);
}
const wait = (w, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) step(w, { x: 0, y: 0 });
};
const until = (w, done, seconds, what) => {
  for (let i = 0; i < seconds * 60; i++) {
    if (done()) return;
    step(w, { x: 0, y: 0 });
  }
  assert.fail(`waited ${seconds}s for ${what}`);
};
const count = (w, state) => w.birds.filter((b) => b.state === state).length;

test("the whole loop: bus, follow, intake, cells, food, coins, unlock a pad", () => {
  const w = create(7);
  assert.equal(w.cells.filter(Boolean).length, 2);

  // a bus drops three birds at the stop
  until(w, () => count(w, "wait") === 3, 10, "the bus");
  assert.equal(w.birds.length, 3);
  assert.equal(hint(w), "walk to the birds at the bus stop");

  // walk to them: they line up behind the warden
  walkTo(w, STOP);
  assert.equal(w.line.length, 3);
  assert.equal(count(w, "follow"), 3);
  const first = w.birds.slice();
  assert.ok(first.every((b) => !b.shirt));

  // a line with no shirts cannot go into a cell (go round the desk, not past it)
  walkTo(w, { x: 200, y: 300 });
  walkTo(w, cellDoor(1));
  wait(w, 1);
  assert.equal(w.line.length, 3, "no shirt, no cell");

  // the desk dresses them, one at a time
  walkTo(w, DESK_SPOT);
  wait(w, 1.2);
  assert.ok(first.every((b) => b.shirt));
  // the one spot left brought a bus with one more bird, still waiting
  assert.equal(w.birds.length, 4);
  assert.equal(count(w, "wait"), 1);

  // two fit in a cell; the third goes next door
  walkTo(w, cellDoor(0));
  wait(w, 1);
  assert.equal(w.line.length, 1);
  walkTo(w, cellDoor(1));
  wait(w, 0.5);
  assert.equal(w.line.length, 0);
  until(w, () => count(w, "cell") === 3, 5, "birds to sit down");
  assert.deepEqual(first.map((b) => b.cell).sort(), [0, 0, 1]);

  // they arrive hungry, and a hungry bird drops no coins
  wait(w, 6);
  assert.equal(w.floor.length, 0);

  // trays from the kitchen to the canteen; hungry birds go and eat
  walkTo(w, KITCHEN_SPOT);
  until(w, () => w.carried === MAX_CARRY, 3, "a full stack");
  wait(w, 1);
  assert.equal(w.carried, MAX_CARRY, "the stack stops at the cap");
  walkTo(w, tableCentre(0));
  until(w, () => w.carried === 0, 3, "the trays to go down");
  assert.equal(w.tables[0].trays, MAX_CARRY);
  until(w, () => first.every((b) => b.food > 0.9 && b.state === "cell"), 15, "everyone to eat and go home");
  assert.equal(w.tables[0].trays, MAX_CARRY - 3);

  // fed birds drop coins by their cells; walking over them banks them
  until(w, () => w.floor.length >= 9, 30, "coins on the floor");
  walkTo(w, cellDoor(0));
  walkTo(w, cellDoor(1));
  assert.ok(w.coins >= 9, `coins ${w.coins}`);

  // the third cell's price tag takes its cost over about a second, then the cell is open
  const pad = PADS.find((p) => p.id === "cell3");
  const had = w.coins;
  walkTo(w, pad.at);
  wait(w, 0.5);
  assert.equal(w.cells[2], false, "not paid yet after half a second");
  wait(w, 1);
  assert.equal(w.cells[2], true);
  assert.equal(w.coins, had - pad.cost);

  // six spots now: once the stop is clear a bus fills them, and never past them
  assert.equal(count(w, "wait"), 1);
  wait(w, 8);
  assert.equal(w.birds.length, 4, "no bus while a bird still waits");
  walkTo(w, STOP);
  until(w, () => w.birds.length === 6, 10, "a bus for the new cell");
  walkTo(w, STOP);
  wait(w, 15);
  assert.equal(w.birds.length, 6);
});

test("same seed, same stick, same jail", () => {
  const play = () => {
    const w = create(42);
    for (let i = 0; i < 60 * 30; i++) step(w, { x: Math.sin(i / 90), y: Math.cos(i / 70) });
    return JSON.stringify(w);
  };
  assert.equal(play(), play());
  const a = create(1), b = create(2);
  for (let i = 0; i < 60 * 5; i++) step(a, { x: 0, y: 0 }), step(b, { x: 0, y: 0 });
  assert.notDeepEqual(a.birds.map((x) => x.look), b.birds.map((x) => x.look));
});

test("a saved jail comes back as it was; junk comes back as nothing", () => {
  const w = create(3);
  wait(w, 5);
  w.coins = 12;
  const back = restore(JSON.stringify(w));
  assert.equal(back.coins, 12);
  assert.equal(back.birds.length, w.birds.length);
  assert.equal(restore(null), null);
  assert.equal(restore("{not json"), null);
  assert.equal(restore(JSON.stringify({ ...w, v: 2 })), null);
  assert.equal(restore(JSON.stringify({ ...w, birds: "x" })), null);
});
