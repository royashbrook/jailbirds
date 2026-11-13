import { test } from "node:test";
import assert from "node:assert/strict";
import { remember, forget, billGeometry, BILL } from "../src/view/view.ts";
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
