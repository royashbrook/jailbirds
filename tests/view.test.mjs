import { test } from "node:test";
import assert from "node:assert/strict";
import { remember, forget, billGeometry, BILL, feel, sway, clearance, SWAY } from "../src/view/view.ts";
import { pegs } from "../src/skins/pegs.ts";

// money is drawn as bills, not coins: a thin flat box, wider than deep, in green
test("the money on the floor, in the piles and in the air is a green bill, not a coin", () => {
  const g = billGeometry();
  assert.equal(g.type, "BoxGeometry");
  assert.deepEqual(g.parameters, { width: 9, height: 0.6, depth: 5, widthSegments: 1, heightSegments: 1, depthSegments: 1 });
  assert.deepEqual(BILL, { w: 9, h: 0.6, d: 5 });
  assert.ok(BILL.h < BILL.d && BILL.d < BILL.w, "flat, and longer than it is wide");
  for (const dark of [false, true]) assert.equal(pegs.palette(dark).coin, "#6cc070", "bill green, day and night");
});

// the view keeps a little per character between frames; a long session must not
// keep it for everyone who ever came and went
test("the view forgets characters who are no longer in the world", () => {
  const w = (ids) => ({ agents: ids.map((id) => ({ id, x: id, y: id, walk: 0 })) });
  const past = new Map();
  remember(w([1, 2, 3, 4]), past);
  assert.deepEqual([...past.keys()], [1, 2, 3, 4]);
  remember(w([1, 3, 9]), past);
  assert.deepEqual([...past.keys()].sort(), [1, 3, 9]);
  const headings = new Map([[1, 0], [5, 1], [6, 2]]);
  forget(w([1]), headings);
  assert.deepEqual([...headings.keys()], [1]);
});

// the warden's line each move in their own time: several ids looked at the same moment are out
// of step with each other, the sway stays small, fades to nothing by a wall, and is the same
// every time for the same id and moment (no dice, nothing kept)
test("followers sway, idle and turn each in their own phase, small, and never into a wall", () => {
  const line = [2, 3, 4, 5, 6, 7];
  const t = 12.5;
  const feels = line.map(feel);
  const apart = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (let i = 0; i < line.length; i++)
    for (let j = i + 1; j < line.length; j++) {
      assert.ok(apart(feels[i].phase, feels[j].phase) > 0.2, `ids ${line[i]} and ${line[j]} out of step`);
      assert.notEqual(feels[i].rate, feels[j].rate);
      assert.notEqual(feels[i].turn, feels[j].turn);
    }
  for (const f of feels) {
    assert.ok(f.rate >= 0.85 && f.rate <= 1.15);
    assert.ok(f.turn >= 0.7 && f.turn <= 1.3);
  }
  // the same spot in open floor, the same heading, the same moment: each its own sway
  const open = [{ x: 0, y: 0, w: 1, h: 1 }];
  const at = line.map((id) => sway(id, t, 500, 500, 0.4, open));
  assert.equal(new Set(at.map((o) => o.x.toFixed(4))).size, line.length, "no two alike");
  for (const o of at) assert.ok(Math.hypot(o.x, o.y) <= SWAY + 1e-9);
  assert.deepEqual(line.map((id) => sway(id, t, 500, 500, 0.4, open)), at, "the same again");
  // across the heading, never along it
  for (const o of at) assert.ok(Math.abs(o.x * Math.sin(0.4) + o.y * Math.cos(0.4)) < 1e-9);
  // a body's width from a wall: no sway at all
  const wall = [{ x: 0, y: 0, w: 10, h: 100 }];
  for (const id of line) {
    const o = sway(id, t, 20, 50, 0, wall);
    assert.equal(Math.hypot(o.x, o.y), 0, `${id} by the wall`);
  }
  assert.equal(clearance(20, 50, wall), 10);
});
