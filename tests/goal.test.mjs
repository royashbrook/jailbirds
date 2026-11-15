import { test } from "node:test";
import assert from "node:assert/strict";
import { create, goal } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";

// the next-goal card (docs/progression.md, P1.1): the pad open now with the least left to pay,
// else the lowest rank that opens a real pad, else nothing
const both = LEVELS.slice(0, 2).map((l, i) => [i, l]);
const pad = (l, id) => l.pads.find((p) => p.id === id);
function world(i, rank, bought = [], paid = {}) {
  const w = create(LEVELS, i, 3);
  w.rank = rank;
  w.bought = bought;
  w.paid = paid;
  return w;
}
// a small level of our own, for shapes the real content does not have
const fake = (pads) => ({ ...LEVELS[0], pads: pads.map((p) => ({ at: { x: 0, y: 0 }, unlock: {}, ...p })) });

for (const [i, L] of both) {
  test(`level ${i}: the least left to pay wins, not the lowest price`, () => {
    const line2 = pad(L, "line2");
    const w = world(i, 3, ["line1"], { line2: line2.cost - 1 });
    assert.ok(pad(L, "cell3").cost > 1 && pad(L, "cell3").cost < line2.cost);
    assert.deepEqual(goal(w, L), { kind: "pad", id: "line2", label: line2.label, cost: line2.cost, paid: line2.cost - 1 });
  });

  test(`level ${i}: a fresh game points at the cheapest open pad, nothing paid`, () => {
    const c = pad(L, "cell3");
    assert.deepEqual(goal(world(i, 1), L), { kind: "pad", id: "cell3", label: c.label, cost: c.cost, paid: 0 });
  });

  test(`level ${i}: a tie goes to content order`, () => {
    // at rank 2 with these bought, speed1 and shower2 both cost the same and nothing cheaper is open
    const w = world(i, 2, ["cell3", "cell4", "line1"]);
    assert.equal(pad(L, "speed1").cost, pad(L, "shower2").cost);
    assert.ok(L.pads.indexOf(pad(L, "speed1")) < L.pads.indexOf(pad(L, "shower2")));
    assert.equal(goal(w, L).id, "speed1");
  });

  test(`level ${i}: a pad behind an unbought one is never chosen`, () => {
    // shower3 is one away from paid, but shower2 comes first and is not bought
    const s3 = pad(L, "shower3");
    assert.equal(s3.after, "shower2");
    const w = world(i, 4, [], { shower3: s3.cost - 1 });
    assert.notEqual(goal(w, L).id, "shower3");
    assert.equal(goal(w, L).id, "cell3");
    // once shower2 is bought it is the one
    assert.equal(goal(world(i, 4, ["shower2"], { shower3: s3.cost - 1 }), L).id, "shower3");
  });

  test(`level ${i}: a pad above the rank is not a pad goal, however little is left`, () => {
    const s2 = pad(L, "shower2");
    assert.equal(s2.rank, 2);
    const w = world(i, 1, [], { shower2: s2.cost - 1 });
    assert.equal(goal(w, L).id, "cell3");
    assert.equal(goal(world(i, 2, [], { shower2: s2.cost - 1 }), L).id, "shower2");
  });

  test(`level ${i}: nothing open at this rank names the next rank and one real pad there`, () => {
    // rank 1 with its two pads bought: the next pads are at rank 2, cell4 first in content order
    const w = world(i, 1, ["cell3", "line1"]);
    assert.deepEqual(goal(w, L), { kind: "rank", rank: 2, id: "cell4", label: pad(L, "cell4").label });
  });

  test(`level ${i}: everything bought is no goal at any rank`, () => {
    const all = L.pads.map((p) => p.id);
    for (const rank of [1, 2, 5, 6, 9, 40]) assert.equal(goal(world(i, rank, all), L), null, `rank ${rank}`);
  });

  test(`level ${i}: asking twice gives the same answer and changes nothing`, () => {
    for (const w of [world(i, 3, ["line1"], { line2: 34 }), world(i, 1, ["cell3", "line1"]), world(i, 9, L.pads.map((p) => p.id))]) {
      const wBefore = JSON.stringify(w), lBefore = JSON.stringify(L);
      const a = goal(w, L), b = goal(w, L);
      assert.deepEqual(a, b);
      assert.equal(JSON.stringify(w), wBefore);
      assert.equal(JSON.stringify(L), lBefore);
    }
  });
}

test("a rank gap names the real next rank, never rank + 1", () => {
  const L = fake([
    { id: "a", cost: 5, rank: 1, label: "first" },
    // hidden behind z, which nobody bought: does not count, even at a lower rank
    { id: "h", cost: 1, rank: 3, after: "z", label: "hidden" },
    { id: "b", cost: 9, rank: 5, label: "far one" },
    { id: "c", cost: 2, rank: 5, label: "far two" },
    { id: "d", cost: 2, rank: 7, label: "further" },
  ]);
  const w = world(0, 2, ["a"]);
  assert.deepEqual(goal(w, L), { kind: "rank", rank: 5, id: "b", label: "far one" });
  // with z bought the hidden one shows, and its rank 3 is the nearer goal
  assert.deepEqual(goal(world(0, 2, ["a", "z"]), L), { kind: "rank", rank: 3, id: "h", label: "hidden" });
  // with every real pad bought there is nothing left, whatever the rank
  assert.equal(goal(world(0, 2, ["a", "b", "c", "d"]), L), null);
});

test("a tie in a level of our own goes to content order, and a pad with no rank is open from the start", () => {
  const L = fake([
    { id: "x", cost: 10, rank: 1, label: "x" },
    { id: "y", cost: 4 },
    { id: "z", cost: 4, label: "zed" },
  ]);
  assert.deepEqual(goal(world(0, 1), L), { kind: "pad", id: "y", label: "y", cost: 4, paid: 0 });
  assert.equal(goal(world(0, 1, [], { x: 7 }), L).id, "x");
});
