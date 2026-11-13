import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { create, step, route, player, boostMult, restore, padVisible, COLLECT_MIN, DT } from "../src/engine/sim.ts";
import { clear, nav, walls } from "../src/engine/geom.ts";
import { LEVELS } from "../src/content/jail.ts";

// the collector: a helper who walks the desks' coins over to the safe, where the player takes them out
const STILL = { x: 0, y: 0 };
const PARK = { x: 330, y: 540 };
const OLD = readFileSync(new URL("./fixtures/v0.1.21-save.json", import.meta.url), "utf8");
const lv = (w) => LEVELS[w.level];
const station = (w, id) => lv(w).stations.find((s) => s.id === id);
const pad = (w, id) => lv(w).pads.find((p) => p.id === id);
const safeOf = (w) => lv(w).stations.find((s) => s.kind === "safe");
const collectors = (w) => w.agents.filter((a) => a.kind === "collector");
const helpers = (w) => w.agents.filter((a) => a.kind !== "agent" && a.kind !== "player");
const sum = (o) => Object.values(o).reduce((n, c) => n + c, 0);
/** every coin there is: in the wallet, on a pile, in a collector's bag, on the floor */
const total = (w) => w.coins + sum(w.piles) + w.agents.reduce((n, a) => n + a.cash, 0) + w.floor.length;

// drive the player like a thumb would, in whichever jail it is in
function go(w, to, cap = 60 * 40) {
  const p = player(w), level = w.level;
  const path = route(w, lv(w), p, to);
  let still = 0;
  for (let i = 0; i < cap; i++) {
    if (!path.length) return;
    const t = path[0], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
    if (d < 1) {
      path.shift();
      continue;
    }
    const s = w.speed * boostMult(w, lv(w)) * DT, was = { x: p.x, y: p.y };
    step(w, LEVELS, d < s ? { x: dx / s, y: dy / s } : { x: dx / d, y: dy / d });
    if (w.level !== level) return;
    still = Math.hypot(p.x - was.x, p.y - was.y) < 0.01 ? still + 1 : 0;
    if (still > 30) assert.fail(`stuck at ${p.x.toFixed(0)},${p.y.toFixed(0)} on the way to ${to.x},${to.y}`);
  }
  assert.fail(`never reached ${to.x},${to.y}`);
}
const wait = (w, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) step(w, LEVELS, STILL);
};
const until = (w, done, seconds, what) => {
  for (let i = 0; i < seconds * 60; i++) {
    if (done()) return;
    step(w, LEVELS, STILL);
  }
  assert.fail(`waited ${seconds}s for ${what}`);
};
/** nobody coming, no squabbles, no surprises: only what a test sets up happens */
function quiet(w) {
  w.ride.t = 1e9;
  w.fightIn = 1e9;
  w.boost.t = 1e9;
  return w;
}
/** a jail with a collector hired off its pad, the player parked out of the way, the wallet as it was */
function hired(level = 0) {
  const w = quiet(create(LEVELS, level, 7));
  w.coins = 1000;
  w.rank = 5;
  go(w, pad(w, "collector").at);
  until(w, () => w.bought.includes("collector"), 4, "the collector hired");
  go(w, PARK);
  w.coins = 0;
  const h = collectors(w)[0];
  until(w, () => !h.moving, 5, "the collector to settle");
  return { w, h };
}
const goal = (h) => h.path.at(-1) ?? h;
const at = (a, p, r = 1) => Math.hypot(a.x - p.x, a.y - p.y) <= r;

test("in both jails: a collector pad on its own at level 5, and a safe there from the start", () => {
  for (const [n, l] of LEVELS.entries()) {
    const p = l.pads.find((x) => x.id === "collector");
    assert.deepEqual(p.at, { x: 420, y: 490 });
    assert.equal(p.rank, 5);
    assert.equal(p.cost, Math.round(100 * (n + 1)), "cost(100) for the jail's scale");
    assert.equal(p.after, undefined, "on offer without anything bought first");
    assert.deepEqual(p.unlock, { helper: "collector" });
    assert.equal(p.label, "hire a collector");
    assert.ok(l.pads.every((x) => x.after !== "collector"), "nothing waits on it");
    const safes = l.stations.filter((s) => s.kind === "safe");
    assert.equal(safes.length, 1);
    assert.deepEqual(safes[0], { id: "safe", kind: "safe", at: { x: 250, y: 785 }, r: 26, pileAt: { x: 220, y: 785 } });
    const w = create(LEVELS, n, 7);
    assert.ok(padVisible(w, p));
    assert.equal(collectors(w).length, 0, "no collector until one is hired");
    assert.equal(w.piles.safe ?? 0, 0);
  }
});

test("in both jails the pad and the safe can be reached from the start and from the helpers' spot", () => {
  for (const [n, l] of LEVELS.entries()) {
    const w = create(LEVELS, n, 7);
    const grid = nav(l, walls(l, (r) => !r.locked, false));
    const safe = safeOf(w);
    for (const from of [l.start, l.helperHome])
      for (const to of [pad(w, "collector").at, safe.at, safe.pileAt]) {
        const path = route(w, l, { ...player(w), x: from.x, y: from.y }, to);
        assert.deepEqual(path.at(-1), to);
        let was = from;
        for (const pt of path) {
          assert.ok(clear(grid, was, pt), `jail ${n + 1}: ${was.x},${was.y} to ${pt.x},${pt.y} runs into a wall`);
          was = pt;
        }
        // and walked for real, bumping into walls on the way
        const v = quiet(create(LEVELS, n, 7));
        Object.assign(player(v), { x: from.x, y: from.y });
        go(v, to);
        assert.ok(at(player(v), to, 2), `jail ${n + 1}: the player got to ${to.x},${to.y}`);
      }
  }
});

test("a collector takes a desk's pile to the safe, and every coin is still there", () => {
  for (const id of ["desk", "stamp"]) {
    const { w, h } = hired();
    const src = station(w, id), safe = safeOf(w);
    w.piles[src.id] = 9;
    const coins = total(w);
    let gathered = false;
    for (let i = 0; i < 60 * 40 && !(w.piles.safe ?? 0); i++) {
      step(w, LEVELS, STILL);
      assert.equal(total(w), coins, "not a coin made or lost");
      if (h.cash && !gathered) {
        gathered = true;
        assert.equal(h.cash, 9);
        assert.equal(w.piles[src.id], 0, "the whole pile");
        assert.ok(at(h, src.pileAt, 30), "picked up standing by it");
      }
    }
    assert.ok(gathered, `the ${id} pile was gathered`);
    assert.equal(w.piles.safe, 9, "and put in the safe");
    assert.equal(h.cash, 0);
    assert.ok(at(h, safe.at, safe.r));
    assert.equal(h.carry, 0, "a bag of coins is not a stack of trays");
    assert.equal(w.coins, 0, "nothing goes into the wallet by itself");
    // with nothing more to do it goes back to stand with the others
    until(w, () => !h.moving, 20, "the collector back home");
    assert.ok(at(h, lv(w).helperHome, 30));
  }
});

test("it goes for the fuller pile, and the player can take the safe's coins like any pile", () => {
  const { w, h } = hired();
  const desk = station(w, "desk"), stamp = station(w, "stamp"), safe = safeOf(w);
  w.piles.desk = 7;
  w.piles.stamp = 10;
  step(w, LEVELS, STILL);
  assert.deepEqual(goal(h), stamp.pileAt, "the fuller one first");
  w.piles.desk = 12;
  step(w, LEVELS, STILL);
  assert.deepEqual(goal(h), desk.pileAt, "and changes its mind when the other grows past it");
  until(w, () => (w.piles.safe ?? 0) === 12, 40, "the desk's pile in the safe");
  until(w, () => (w.piles.safe ?? 0) === 22, 40, "then the release desk's");
  const before = total(w);
  go(w, safe.pileAt);
  assert.equal(w.coins, 22, "the player takes the safe's coins by walking over them");
  assert.equal(w.piles.safe, 0);
  assert.equal(total(w), before);
});

test("a pile the player empties first: the collector turns back, or on to the other one", () => {
  const { w, h } = hired();
  const desk = station(w, "desk"), stamp = station(w, "stamp");
  w.piles.desk = 8;
  wait(w, 1);
  assert.deepEqual(goal(h), desk.pileAt);
  assert.ok(h.moving, "on its way");
  // the player is in intake already, and nips over to the pile first
  Object.assign(player(w), { x: 100, y: 690 });
  go(w, desk.pileAt);
  assert.equal(w.coins, 8, "the player got there first");
  step(w, LEVELS, STILL);
  assert.equal(h.cash, 0);
  assert.notDeepEqual(goal(h), desk.pileAt, "nothing left there to fetch");
  assert.ok(at(goal(h), lv(w).helperHome, 20), "so it heads home");
  w.piles.stamp = 6;
  step(w, LEVELS, STILL);
  assert.deepEqual(goal(h), stamp.pileAt, "until there is another pile to fetch");
  until(w, () => (w.piles.safe ?? 0) === 6, 40, "the other pile in the safe");
});

test("a pile both reach in the same step is the player's", () => {
  const { w, h } = hired();
  const desk = station(w, "desk");
  Object.assign(h, { x: desk.pileAt.x, y: desk.pileAt.y, path: [] });
  Object.assign(player(w), { x: desk.pileAt.x + 4, y: desk.pileAt.y });
  w.piles.desk = 9;
  step(w, LEVELS, STILL);
  assert.equal(w.coins, 9, "all of it to the player");
  assert.equal(h.cash, 0, "none to the collector");
  assert.equal(w.piles.desk, 0);
});

test("coins on the floor are only ever the player's", () => {
  const { w, h } = hired();
  const desk = station(w, "desk"), safe = safeOf(w);
  // coins lying on the pile, all along the way, and at the safe
  const lying = [desk.pileAt, { x: 140, y: 790 }, safe.at, safe.pileAt, h].map((p) => ({ x: p.x, y: p.y, house: "" }));
  w.floor.push(...lying);
  w.piles.desk = 8;
  until(w, () => (w.piles.safe ?? 0) === 8, 40, "the pile in the safe");
  until(w, () => !h.moving, 20, "the collector back home");
  assert.deepEqual(w.floor, lying, "every coin still on the floor, where it was");
  assert.equal(w.coins, 0);
});

test("five coins are not worth the walk, six are", () => {
  assert.equal(COLLECT_MIN, 6);
  const { w, h } = hired();
  const desk = station(w, "desk");
  w.piles.desk = 5;
  wait(w, 12);
  assert.equal(w.piles.desk, 5);
  assert.equal(h.cash, 0);
  assert.equal(w.piles.safe ?? 0, 0);
  // standing right on it does not change its mind
  Object.assign(h, { x: desk.pileAt.x, y: desk.pileAt.y, path: [] });
  step(w, LEVELS, STILL);
  assert.equal(h.cash, 0, "five stay put");
  w.piles.desk = 6;
  step(w, LEVELS, STILL);
  assert.equal(h.cash, 6, "six are taken");
});

test("a collector with coins puts them in the safe before it takes any more", () => {
  const { w, h } = hired();
  const desk = station(w, "desk"), safe = safeOf(w);
  Object.assign(h, { x: desk.pileAt.x, y: desk.pileAt.y, path: [], cash: 4 });
  w.piles.desk = 10;
  const coins = total(w);
  step(w, LEVELS, STILL);
  assert.equal(h.cash, 4, "it does not take more on top");
  assert.equal(w.piles.desk, 10);
  assert.deepEqual(goal(h), safe.at, "it heads for the safe");
  until(w, () => (w.piles.safe ?? 0) === 4, 40, "the first coins in the safe");
  assert.equal(w.piles.desk, 10, "the pile waited");
  until(w, () => (w.piles.safe ?? 0) === 14, 40, "then the pile");
  assert.equal(total(w), coins);
});

test("in both jails all seven hired helpers stand apart when idle and find their way back", () => {
  const hires = ["cook", "guard", "guard2", "guard3", "clerk", "cleaner", "collector"];
  for (const n of [0, 1]) {
    const w = quiet(create(LEVELS, n, 7));
    w.coins = 5000;
    w.rank = 6;
    for (const id of hires) {
      go(w, pad(w, id).at);
      until(w, () => w.bought.includes(id), 4, id);
    }
    go(w, PARK);
    const hs = helpers(w);
    assert.equal(hs.length, 7);
    assert.deepEqual(hs.map((a) => a.kind).sort(), ["carrier", "cleaner", "clerk", "collector", "escort", "escort", "escort"]);
    // scatter them, then let them settle: the cook fills the tables first, the clerk goes to the desk
    const far = [{ x: 600, y: 790 }, { x: 250, y: 785 }, { x: 60, y: 420 }, { x: 600, y: 400 }, { x: 140, y: 700 }, { x: 395, y: 412 }, { x: 600, y: 200 }];
    hs.forEach((a, i) => Object.assign(a, { x: far[i].x, y: far[i].y, path: [] }));
    wait(w, 40);
    for (const a of hs) assert.ok(!a.moving, `jail ${n + 1}: the ${a.kind} got where it was going`);
    const idle = hs.filter((a) => a.kind !== "clerk");
    for (const a of idle) assert.ok(at(a, lv(w).helperHome, 40), `jail ${n + 1}: the ${a.kind} is home`);
    for (let i = 0; i < hs.length; i++)
      for (let j = i + 1; j < hs.length; j++)
        assert.ok(Math.hypot(hs[i].x - hs[j].x, hs[i].y - hs[j].y) >= 12, `jail ${n + 1}: ${hs[i].kind} and ${hs[j].kind} apart`);
  }
});

test("an old save has no collector and an empty safe, and nothing else changes", () => {
  const raw = JSON.parse(OLD);
  const back = restore(OLD, LEVELS);
  assert.equal(collectors(back).length, 0);
  assert.equal(back.piles.safe ?? 0, 0);
  assert.ok(padVisible(back, pad(back, "collector")), "on offer, not given");
  for (const [k, v] of Object.entries(raw)) {
    if (k === "agents") continue;
    assert.deepEqual(back[k], v, k);
  }
  // the only new things on an old save's people: an empty bag, and no unrest yet
  assert.deepEqual(back.agents.map(({ cash, unrest, ...a }) => a), raw.agents);
  assert.ok(back.agents.every((a) => a.cash === 0 && a.unrest === 0));
  assert.deepEqual(back.took, { n: 0, floor: 0, rank: 0, piles: {} });
});

test("coins in a collector's bag are put in the safe on reload, once, however often it is reloaded", () => {
  const { w, h } = hired();
  w.piles.safe = 4;
  h.cash = 9;
  const coins = total(w);
  let back = restore(JSON.stringify(w), LEVELS);
  assert.equal(back.piles.safe, 13);
  assert.equal(collectors(back)[0].cash, 0, "the bag is empty in the same snapshot");
  assert.equal(total(back), coins);
  for (let i = 0; i < 3; i++) {
    back = restore(JSON.stringify(back), LEVELS);
    assert.equal(back.piles.safe, 13, "a second reload adds nothing");
    assert.equal(total(back), coins);
    for (let k = 0; k < 30; k++) step(back, LEVELS, STILL);
    assert.equal(total(back), coins, "and playing on adds nothing");
  }
  // a bag that cannot be read is an empty one
  for (const bad of ["x", -3, null, 1e400, undefined]) {
    const odd = JSON.parse(JSON.stringify(w));
    odd.piles.safe = 4;
    for (const a of odd.agents) a.cash = bad;
    if (bad === undefined) for (const a of odd.agents) delete a.cash;
    const got = restore(JSON.stringify(odd), LEVELS);
    assert.ok(got.agents.every((a) => a.cash === 0), String(bad));
    assert.equal(got.piles.safe, 4, String(bad));
  }
});

test("the next jail: the old safe and the collector's bag go into the new safe once, and the wallet is untouched", () => {
  const run = (keep) => {
    const { w, h } = hired();
    w.rank = 6;
    w.coins = 500;
    if (keep) {
      w.piles.safe = 15;
      h.cash = 9;
    }
    w.piles.desk = 4;
    go(w, pad(w, "next").at);
    until(w, () => w.level === 1, 5, "the next jail");
    return w;
  };
  const w = run(true), plain = run(false);
  assert.equal(w.piles.safe, 24, "15 in the safe and 9 in the bag");
  assert.equal(plain.piles.safe ?? 0, 0);
  assert.equal(w.coins, plain.coins, "the wallet is what it would have been anyway");
  assert.equal(w.piles.desk ?? 0, 0, "the rest starts fresh");
  assert.equal(collectors(w).length, 0, "the collector stays behind, as all help does");
  wait(w, 2);
  assert.equal(w.piles.safe, 24, "once");
  const back = restore(JSON.stringify(w), LEVELS);
  assert.equal(back.piles.safe, 24, "and once across a reload");
});
