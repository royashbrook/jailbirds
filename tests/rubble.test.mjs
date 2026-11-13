import { test } from "node:test";
import assert from "node:assert/strict";
import { Euler, Matrix4 } from "three";
import { capacity, create, step } from "../src/engine/sim.ts";
import { WALL } from "../src/engine/geom.ts";
import { LEVELS } from "../src/content/jail.ts";
import { newAtlas, readMap, record } from "../src/lib/map.ts";
import { pegs } from "../src/skins/pegs.ts";
import { RUBBLE_TOP, rubbleRooms, rubbleStones } from "../src/view/scene.ts";
import { cleared } from "../src/view/view.ts";

// the cells still to open are drawn full of rubble. which ones is read off the same things the sim
// reads (room.locked, the pad that names the room, bought), and how the stones lie is the room's own,
// never the jail's dice
const CELLS = [["cell3", "c2"], ["cell4", "c3"], ["cell5", "c4"], ["cell6", "c5"], ["cell7", "c6"], ["cell8", "c7"]];
const ids = (rooms) => rooms.map((r) => r.id);

test("the six cells still shut are the rubble, in both jails, and nothing else ever is", () => {
  for (const l of LEVELS) {
    const w = create(LEVELS, LEVELS.indexOf(l), 5);
    assert.deepEqual(ids(rubbleRooms(l, w)), CELLS.map(([, room]) => room), l.id);
    // each one is the room its pad opens, at the price and rank it always had
    for (const [pad, room] of CELLS) {
      const p = l.pads.find((x) => x.id === pad);
      assert.equal(p.unlock.room, room);
      assert.equal(l.rooms.find((r) => r.id === room).locked, pad);
      assert.equal(p.label, "clear cell");
    }
    // the cells open from the start, the block and the food and wash rooms: never
    for (const id of ["c0", "c1", "block", "canteen", "kitchen", "showers", "intake", "release"]) assert.ok(!ids(rubbleRooms(l, w)).includes(id), id);
    // bought one by one, each leaves the rubble as it is bought, and only that one
    for (let i = 0; i < CELLS.length; i++) {
      w.bought.push(CELLS[i][0]);
      assert.deepEqual(ids(rubbleRooms(l, w)), CELLS.slice(i + 1).map(([, room]) => room));
    }
    // every other pad bought too changes nothing more
    w.bought.push(...l.pads.map((p) => p.id).filter((id) => !w.bought.includes(id)));
    assert.deepEqual(rubbleRooms(l, w), []);
  }
});

test("paid in part is still rubble: only bought opens a cell", () => {
  const l = LEVELS[0], w = create(LEVELS, 0, 5);
  w.paid.cell3 = 7;
  assert.ok(ids(rubbleRooms(l, w)).includes("c2"));
  w.paid.cell3 = 8;
  assert.ok(ids(rubbleRooms(l, w)).includes("c2"), "paid in full but not yet bought is the sim's call, not the view's");
});

test("the stones lie the same way every time, from the room alone, and never roll the jail's dice", () => {
  const l = LEVELS[0];
  const a = create(LEVELS, 0, 1), b = create(LEVELS, 0, 987654321);
  const rngA = a.rng, rngB = b.rng;
  const first = rubbleRooms(l, a).map((r) => JSON.stringify(rubbleStones(r)));
  const second = rubbleRooms(l, b).map((r) => JSON.stringify(rubbleStones(r)));
  assert.deepEqual(first, second, "two jails with different dice, the same rubble");
  assert.equal(a.rng, rngA);
  assert.equal(b.rng, rngB);
  // and the same in desert rock, room for room
  assert.deepEqual(rubbleRooms(LEVELS[1], create(LEVELS, 1, 3)).map((r) => JSON.stringify(rubbleStones(r))), first);
  // each cell its own heap, not one heap copied six times
  assert.equal(new Set(first).size, first.length);
  // a jail played on rolls its dice, and the rubble does not care
  const played = create(LEVELS, 0, 1);
  for (let i = 0; i < 600; i++) step(played, LEVELS, { x: 0, y: 0 });
  assert.notEqual(played.rng, rngA);
  assert.deepEqual(rubbleRooms(l, played).map((r) => JSON.stringify(rubbleStones(r))), first);
});

test("the rubble is a bounded heap of chunky stones inside the cell's walls and under a standing head", () => {
  const l = LEVELS[0];
  const head = pegs.model.height - 4.6 * 2 - 4;
  assert.ok(RUBBLE_TOP < head, `the top ${RUBBLE_TOP} is under the head at ${head}`);
  for (const room of rubbleRooms(l, create(LEVELS, 0, 1))) {
    const stones = rubbleStones(room), { x, y, w, h } = room.rect, inset = WALL / 2 + 1;
    assert.ok(stones.length >= 12 && stones.length <= 30, `${room.id}: ${stones.length} stones`);
    // the same stones handed back each time, not made again
    assert.equal(rubbleStones(room), stones);
    for (const s of stones) {
      // worked out here on its own: the turned, scaled unit ball each stone fits in
      const e = new Matrix4().makeRotationFromEuler(new Euler(s.rx, s.ry, s.rz)).elements;
      const reach = (a, b, c) => Math.hypot(a * s.sx, b * s.sy, c * s.sz);
      const ex = reach(e[0], e[4], e[8]), ey = reach(e[1], e[5], e[9]), ez = reach(e[2], e[6], e[10]);
      assert.ok(s.x - ex >= x + inset - 1e-9 && s.x + ex <= x + w - inset + 1e-9, `${room.id} stone across a side wall at ${s.x}`);
      assert.ok(s.z - ez >= y + inset - 1e-9 && s.z + ez <= y + h - inset + 1e-9, `${room.id} stone across the front or back wall at ${s.z}`);
      assert.ok(s.y + ey <= RUBBLE_TOP + 1e-9, `${room.id} stone too tall: ${s.y + ey}`);
      // and the extents the view is handed are the true ones
      assert.ok(Math.abs(s.ex - ex) + Math.abs(s.ey - ey) + Math.abs(s.ez - ez) < 1e-9);
      // chunky: no splinters or slabs
      assert.ok(Math.min(s.sx, s.sy, s.sz) >= 3, "too thin");
      assert.ok(s.tone >= 0 && Number.isInteger(s.tone));
    }
    // the corridor in front, where the pad and the route to the beds are, stays clear: the cell ends at y 146
    assert.ok(Math.max(...stones.map((s) => s.z + Math.max(s.sx, s.sy, s.sz))) < 146);
    // and the heap has a top: the middle stands higher than the edges
    const mid = stones.filter((s) => s.y > 6).length;
    assert.ok(mid >= 4, `${room.id}: ${mid} stones up on the heap`);
  }
});

test("only a cell bought in the jail being drawn shows being cleared: opening, travel and start over never replay one", () => {
  const all = CELLS.map(([, room]) => room);
  // bought here, just now: that cell, once
  assert.deepEqual(cleared(all, all.slice(1), true), ["c2"]);
  // nothing drawn of this world yet (the page opened, a trip, a start over): nothing shows, whatever is open
  assert.deepEqual(cleared(null, [], true), []);
  assert.deepEqual(cleared(null, all.slice(3), false), []);
  // drawn again for another reason (night came, or fewer bought after a start over): nothing shows
  assert.deepEqual(cleared(all.slice(1), all.slice(1), false), []);
  assert.deepEqual(cleared(all.slice(2), all, false), []);
  // something else bought (a longer line): the rubble is the same, nothing shows
  assert.deepEqual(cleared(all.slice(1), all.slice(1), true), []);
});

test("a cell bought stays open after the jail is saved and opened again, and beds go 4 to 16", () => {
  const l = LEVELS[0];
  const a = newAtlas(LEVELS, 11);
  assert.equal(capacity(a.world, l), 4);
  a.world.bought.push("cell3");
  a.world.paid.cell3 = 8;
  const again = readMap(JSON.stringify(record(a)), LEVELS);
  assert.ok(again);
  assert.deepEqual(again.world.bought, ["cell3"]);
  assert.ok(!ids(rubbleRooms(l, again.world)).includes("c2"));
  assert.equal(capacity(again.world, l), 6);
  // and again, with all six: no cell goes back to rubble, sixteen beds
  again.world.bought.push("cell4", "cell5", "cell6", "cell7", "cell8");
  const third = readMap(JSON.stringify(record(again)), LEVELS);
  assert.deepEqual(rubbleRooms(l, third.world), []);
  assert.equal(capacity(third.world, l), 16);
});
